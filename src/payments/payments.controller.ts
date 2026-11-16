import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('Payments (Stripe)')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Create a Stripe Checkout Session for an order' })
  createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.createCheckoutSession(userId, dto.orderId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe Webhook endpoint for payment events' })
  handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Raw body not available');
    }
    return this.paymentsService.handleWebhook(signature, req.rawBody);
  }

  @Post(':orderId/confirm-success')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Confirm or simulate successful payment for an order',
  })
  confirmSuccess(@Param('orderId') orderId: string) {
    return this.paymentsService.markPaymentSucceeded(orderId);
  }

  @Post(':orderId/confirm-failed')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Simulate or record a failed payment for an order',
  })
  confirmFailed(@Param('orderId') orderId: string) {
    return this.paymentsService.markPaymentFailed(orderId);
  }

  @Post(':orderId/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Refund a completed payment and restore order stock',
  })
  refundPayment(@Param('orderId') orderId: string, @Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.refundPayment(orderId, userId, req.user.role);
  }

  @Get('order/:orderId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get payment details for a specific order' })
  getPaymentByOrder(@Param('orderId') orderId: string, @Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.paymentsService.getPaymentByOrder(
      orderId,
      userId,
      req.user.role,
    );
  }
}