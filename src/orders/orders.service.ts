import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, Role } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsGateway, // INJECTED SOCKETS
  ) {}

  // 1. Place an order from the user's current shopping cart
  async createOrderFromCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: true } },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Your shopping cart is empty');
    }

    for (const item of cart.items) {
      if (item.product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${item.product.name}". Available: ${item.product.stock}, Requested: ${item.quantity}`,
        );
      }
    }

    const totalAmount = cart.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId,
          totalAmount: Number(totalAmount.toFixed(2)),
          status: OrderStatus.PENDING,
          items: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.product.price,
            })),
          },
        },
        include: {
          items: { include: { product: true } },
          payment: true,
        },
      });

      for (const item of cart.items) {
        const updatedProduct = await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });

        // SOCKET EVENT: Broadcast global stock update
        this.notifications.notifyStockUpdate(
          updatedProduct.id,
          updatedProduct.name,
          updatedProduct.stock,
        );
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return order;
    });

    // SOCKET EVENT: Alert Admins of new order
    this.notifications.notifyNewOrder(result.id, result.totalAmount);
    // SOCKET EVENT: Notify User their order is pending
    this.notifications.notifyOrderStatus(result.id, userId, result.status);

    return result;
  }

  // 2. Get Order History
  async findAll(userId: string, role: Role) {
    const where = role === Role.ADMIN ? {} : { userId };
    return this.prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, price: true, images: true } } } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 3. Get Single Order Details
  async findOne(orderId: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: { include: { product: { include: { images: true } } } },
        payment: true,
      },
    });

    if (!order) throw new NotFoundException(`Order with ID "${orderId}" not found`);
    if (role !== Role.ADMIN && role !== Role.SELLER && order.userId !== userId) {
      throw new ForbiddenException('You do not have permission to view this order');
    }
    return order;
  }

  // 4. Update Order Status (Admin / Seller)
  async updateStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order with ID "${orderId}" not found`);
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot update status of a cancelled order');
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
      include: { items: { include: { product: true } }, payment: true },
    });

    // SOCKET EVENT: Notify User of status change
    this.notifications.notifyOrderStatus(updatedOrder.id, updatedOrder.userId, updatedOrder.status);

    return updatedOrder;
  }

  // 5. Cancel Order & Restore Product Stock
  async cancelOrder(orderId: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException(`Order with ID "${orderId}" not found`);
    if (role !== Role.ADMIN && order.userId !== userId) throw new ForbiddenException('You can only cancel your own orders');
    if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException(`Cannot cancel an order that is already ${order.status}`);
    }
    if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('Order is already cancelled');

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
        include: { items: { include: { product: true } }, payment: true },
      });

      for (const item of order.items) {
        const restoredProduct = await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });

        // SOCKET EVENT: Broadcast global stock update
        this.notifications.notifyStockUpdate(
          restoredProduct.id,
          restoredProduct.name,
          restoredProduct.stock,
        );
      }

      return updatedOrder;
    });

    // SOCKET EVENT: Notify User of cancellation
    this.notifications.notifyOrderStatus(result.id, result.userId, result.status);

    return result;
  }
}