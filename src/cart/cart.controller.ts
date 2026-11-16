import {
  Body,
  Controller,
  Delete,
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
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('Cart')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user shopping cart' })
  getCart(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.cartService.getCart(userId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a product to the shopping cart' })
  addToCart(@Req() req: any, @Body() dto: AddToCartDto) {
    const userId = req.user.id || req.user.sub;
    return this.cartService.addToCart(userId, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update quantity of a specific cart item' })
  updateItemQuantity(
    @Req() req: any,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const userId = req.user.id || req.user.sub;
    return this.cartService.updateItemQuantity(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove a specific item from the cart' })
  removeItem(@Req() req: any, @Param('itemId') itemId: string) {
    const userId = req.user.id || req.user.sub;
    return this.cartService.removeItem(userId, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear all items from the cart' })
  clearCart(@Req() req: any) {
    const userId = req.user.id || req.user.sub;
    return this.cartService.clearCart(userId);
  }
}