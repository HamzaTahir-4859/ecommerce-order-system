import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // rawBody: true is REQUIRED for Stripe Webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS so your React frontend can communicate with this API
  app.enableCors();

  // Global DTO validation for CRUD & Pagination
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Submission Requirement: Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('E-Commerce & Order Management API')
    .setDescription('NestJS, Prisma, PostgreSQL, Socket.IO & Stripe API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // This maps the Swagger UI to the /api/docs endpoint
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger Docs available at http://localhost:${port}/api/docs`);
}
bootstrap();