import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    console.log('🚀 Socket.IO Server Initialized');
  }

  handleConnection(client: Socket) {
    console.log(`🟢 Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`🔴 Client disconnected: ${client.id}`);
  }

  // 1. Notify Admins/Sellers of a new order
  notifyNewOrder(orderId: string, amount: number) {
    this.server.emit('admin-order-alert', {
      orderId,
      amount,
      message: `A new order (${orderId}) was just placed for $${amount}!`,
    });
  }

  // 2. Notify Customer of an order status change
  notifyOrderStatus(orderId: string, userId: string, status: string) {
    // We broadcast to a specific event string tailored to the user's ID
    this.server.emit(`user-${userId}-order`, {
      orderId,
      status,
      message: `Your order status has been updated to: ${status}`,
    });
  }

  // 3. Notify everyone of global stock availability changes
  notifyStockUpdate(productId: string, productName: string, newStock: number) {
    this.server.emit('stock-alert', {
      productId,
      productName,
      stock: newStock,
      message: `${productName} stock is now ${newStock}`,
    });
  }
}