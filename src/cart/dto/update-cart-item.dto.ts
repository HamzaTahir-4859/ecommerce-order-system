import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    example: 2,
    description: 'The new quantity for this cart item',
  })
  @IsInt()
  @Min(1)
  quantity: number;
}