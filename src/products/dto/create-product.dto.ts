import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductVariantDto {
  @ApiProperty({ example: 'LAP-BLK-16GB' })
  @IsString()
  @IsNotEmpty()
  sku: string;

  @ApiPropertyOptional({ example: '15-inch' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ example: 'Matte Black' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 1299.99 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Predator Gaming Laptop' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'High-performance gaming laptop with GTX 1660 Ti' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 1199.99 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiProperty({ description: 'UUID of the Category' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    example: [
      'https://example.com/images/laptop-front.jpg',
      'https://example.com/images/laptop-side.jpg',
    ],
    description: 'Array of image URLs',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({
    type: [ProductVariantDto],
    description: 'Optional product variations (size, color, SKU, stock)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}