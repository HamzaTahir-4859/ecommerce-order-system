import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, Role } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  // 1. Place an order from the user's current shopping cart
  async createOrderFromCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Your shopping cart is empty');
    }

    // Validate stock for every item before creating the order
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

    // Use a transaction to create the order, deduct stock, and clear the cart atomically
    return this.prisma.$transaction(async (tx) => {
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
          items: {
            include: {
              product: {
                select: { id: true, name: true, price: true },
              },
            },
          },
          payment: true,
        },
      });

      // Deduct stock for each purchased product
      for (const item of cart.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity },
          },
        });
      }

      // Clear the user's cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return order;
    });
  }

  // 2. Get Order History (Customers see their own; Admins see all)
  async findAll(userId: string, role: Role) {
    const where = role === Role.ADMIN ? {} : { userId };

    return this.prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, price: true, images: true },
            },
          },
        },
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
        items: {
          include: {
            product: {
              include: { images: true },
            },
          },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (role !== Role.ADMIN && role !== Role.SELLER && order.userId !== userId) {
      throw new ForbiddenException('You do not have permission to view this order');
    }

    return order;
  }

  // 4. Update Order Status (Admin / Seller)
  async updateStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot update status of a cancelled order');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
      include: {
        items: { include: { product: true } },
        payment: true,
      },
    });
  }

  // 5. Cancel Order & Restore Product Stock
  async cancelOrder(orderId: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${orderId}" not found`);
    }

    if (role !== Role.ADMIN && order.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own orders');
    }

    if (
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED
    ) {
      throw new BadRequestException(
        `Cannot cancel an order that is already ${order.status}`,
      );
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    // Cancel order and restore stock in a single transaction
    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
        include: {
          items: { include: { product: true } },
          payment: true,
        },
      });

      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
          },
        });
      }

      return updatedOrder;
    });
  }
}