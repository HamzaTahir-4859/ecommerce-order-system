import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { Prisma, Role } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(sellerId: string, dto: CreateProductDto) {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category) {
      throw new NotFoundException(
        `Category with ID "${dto.categoryId}" not found`,
      );
    }

    const { images, variants, ...productData } = dto;

    return this.prisma.product.create({
      data: {
        name: productData.name,
        description: productData.description,
        price: productData.price,
        stock: productData.stock,
        categoryId: productData.categoryId,
        sellerId,
        images: images?.length
          ? {
              create: images.map((url) => ({ url })),
            }
          : undefined,
        variants: variants?.length
          ? {
              create: variants.map((v) => ({
                sku: v.sku,
                size: v.size,
                color: v.color,
                price: v.price,
                stock: v.stock,
              })),
            }
          : undefined,
      },
      include: {
        category: true,
        images: true,
        variants: true,
        seller: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findAll(query: QueryProductDto) {
    const {
      page = 1,
      limit = 10,
      search,
      categoryId,
      minPrice,
      maxPrice,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Assign the price filter in one object to avoid TS union-type errors
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {
        ...(minPrice !== undefined ? { gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
      };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          images: true,
          variants: true,
          seller: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: true,
        variants: true,
        seller: { select: { id: true, name: true, email: true } },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    return product;
  }

  async update(
    id: string,
    userId: string,
    userRole: Role,
    dto: UpdateProductDto,
  ) {
    const product = await this.findOne(id);

    if (userRole !== Role.ADMIN && product.sellerId !== userId) {
      throw new ForbiddenException('You can only update your own products');
    }

    const { images, variants, ...productData } = dto;

    return this.prisma.product.update({
      where: { id },
      data: {
        ...productData,
        ...(images && {
          images: {
            deleteMany: {},
            create: images.map((url) => ({ url })),
          },
        }),
        ...(variants && {
          variants: {
            deleteMany: {},
            create: variants.map((v) => ({
              sku: v.sku,
              size: v.size,
              color: v.color,
              price: v.price,
              stock: v.stock,
            })),
          },
        }),
      },
      include: {
        category: true,
        images: true,
        variants: true,
      },
    });
  }

  async remove(id: string, userId: string, userRole: Role) {
    const product = await this.findOne(id);

    if (userRole !== Role.ADMIN && product.sellerId !== userId) {
      throw new ForbiddenException('You can only delete your own products');
    }

    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted successfully' };
  }
}