import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';

export class AddToCartDto {
  @ApiProperty({ description: 'The UUID of the product to add' })
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}