import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, PaymentStatus, Role } from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
    );
  }

  // 1. Create Stripe Checkout Session for an Order
  async createCheckoutSession(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { product: true },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('You can only pay for your own orders');
    }

    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('This order has already been paid for');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Create a Stripe Checkout Session
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: order.items.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.product.name,
            description: item.product.description || undefined,
          },
          unit_amount: Math.round(item.price * 100), // Stripe expects cents
        },
        quantity: item.quantity,
      })),
      metadata: {
        orderId: order.id,
        userId,
      },
      success_url: `${frontendUrl}/orders/${order.id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/orders/${order.id}?payment=cancelled`,
    });

    // Upsert the Payment record in PostgreSQL
    const payment = await this.prisma.payment.upsert({
      where: { orderId: order.id },
      update: {
        stripeId: session.id,
        amount: order.totalAmount,
        status: PaymentStatus.PENDING,
      },
      create: {
        orderId: order.id,
        stripeId: session.id,
        amount: order.totalAmount,
        status: PaymentStatus.PENDING,
      },
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      payment,
    };
  }

  // 2. Stripe Webhook Handler (Listens for checkout.session.completed & payment_intent.payment_failed)
  async handleWebhook(signature: string, rawBody: Buffer) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err: any) {
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.id;

      if (orderId) {
        await this.markPaymentSucceeded(orderId, paymentIntentId);
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata?.orderId;

      if (orderId) {
        await this.markPaymentFailed(orderId);
      }
    }

    return { received: true, type: event.type };
  }

  // 3. Helper / Endpoint to Confirm Payment Success (Used by Webhook & Frontend/Swagger testing)
  async markPaymentSucceeded(orderId: string, stripeId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.upsert({
        where: { orderId },
        update: {
          status: PaymentStatus.COMPLETED,
          ...(stripeId ? { stripeId } : {}),
        },
        create: {
          orderId,
          stripeId: stripeId || `sim_pi_${Date.now()}`,
          amount: order.totalAmount,
          status: PaymentStatus.COMPLETED,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
          status: OrderStatus.PROCESSING,
        },
      });

      return { order: updatedOrder, payment };
    });
  }

  // 4. Mark Payment as Failed
  async markPaymentFailed(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.upsert({
        where: { orderId },
        update: { status: PaymentStatus.FAILED },
        create: {
          orderId,
          amount: order.totalAmount,
          status: PaymentStatus.FAILED,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: PaymentStatus.FAILED },
      });

      return { order: updatedOrder, payment };
    });
  }

  // 5. Refund Payment (Admin or Order Owner) & Restore Product Stock
  async refundPayment(orderId: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (role !== Role.ADMIN && order.userId !== userId) {
      throw new ForbiddenException('You are not authorized to refund this order');
    }

    if (
      !order.payment ||
      order.paymentStatus !== PaymentStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Only orders with COMPLETED payments can be refunded',
      );
    }

    // Attempt Stripe API refund if a real Stripe PaymentIntent ID is stored
    if (
      order.payment.stripeId &&
      order.payment.stripeId.startsWith('pi_')
    ) {
      await this.stripe.refunds.create({
        payment_intent: order.payment.stripeId,
      });
    } else if (
      order.payment.stripeId &&
      order.payment.stripeId.startsWith('cs_')
    ) {
      const session = await this.stripe.checkout.sessions.retrieve(
        order.payment.stripeId,
      );
      if (typeof session.payment_intent === 'string') {
        await this.stripe.refunds.create({
          payment_intent: session.payment_intent,
        });
      }
    }

    // Update DB status to REFUNDED + CANCELLED and restore stock
    return this.prisma.$transaction(async (tx) => {
      const refundedPayment = await tx.payment.update({
        where: { orderId },
        data: { status: PaymentStatus.REFUNDED },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.REFUNDED,
          status: OrderStatus.CANCELLED,
        },
      });

      // Restore product inventory if order wasn't already cancelled
      if (order.status !== OrderStatus.CANCELLED) {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      return {
        message: 'Payment refunded and product stock restored successfully',
        order: updatedOrder,
        payment: refundedPayment,
      };
    });
  }

  // 6. Get Payment Details by Order ID
  async getPaymentByOrder(orderId: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (role !== Role.ADMIN && order.userId !== userId) {
      throw new ForbiddenException('You cannot view this payment');
    }

    if (!order.payment) {
      throw new NotFoundException('No payment record found for this order');
    }

    return order.payment;
  }
}