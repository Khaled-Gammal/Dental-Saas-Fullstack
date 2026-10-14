import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: cfg.NODE_ENV === 'production', prefix: 'api' }),
  });
  app.enableCors({ origin: [cfg.DASHBOARD_URL], credentials: true });
  app.enableShutdownHooks();

  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Dental SaaS API').setVersion('0.1.0').addBearerAuth().build(),
  );
  if (process.argv.includes('--export-openapi')) {
    const out = path.resolve(__dirname, '../openapi.json');
    writeFileSync(out, JSON.stringify(openapi, null, 2));
    console.log(`OpenAPI written to ${out}`);
    await app.close();
    return;
  }
  SwaggerModule.setup('docs', app, openapi);

  await app.listen(cfg.API_PORT);
  console.log(`API ready on http://localhost:${cfg.API_PORT}  (docs: /docs)`);
}

void bootstrap();
