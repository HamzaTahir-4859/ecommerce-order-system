import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Role } from '@prisma/client';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Place a new order from the current shopping cart' })
  createOrder(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.ordersService.createOrderFromCart(userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get order history (Customer: own orders, Admin: all orders)',
  })
  findAll(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.ordersService.findAll(userId, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific order' })
  findOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.ordersService.findOne(id, userId, req.user.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update order status (Admin/Seller only)' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: any,
  ) {
    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SELLER) {
      throw new ForbiddenException(
        'Only Admins and Sellers can update order status',
      );
    }
    return this.ordersService.updateStatus(id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an order and restore product stock' })
  cancelOrder(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.ordersService.cancelOrder(id, userId, req.user.role);
  }
}