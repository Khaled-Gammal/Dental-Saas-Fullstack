import './threadpool';
import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { initSentry } from './shared/observability/sentry';

async function bootstrap() {
  const cfg = loadConfig();
  initSentry('api', cfg); // Phase 1B: off without SENTRY_DSN
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: cfg.NODE_ENV === 'production', prefix: 'api' }),
  });
  app.enableCors({ origin: [cfg.DASHBOARD_URL], credentials: true });
  // review R11: Express's default 100 kB refused a legal document of about 50,000 Arabic characters (2 bytes each) with
  // 413, though the schema allows 200,000; 1 MB covers that and stays small. Uploads go through multipart, not JSON.
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  // behind a proxy (Caddy / load balancer) req.ip must be the client's address, not the proxy's
  app.getHttpAdapter().getInstance().set('trust proxy', cfg.TRUST_PROXY); // see TRUST_PROXY in config.ts

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
  // API docs are public in development only, unless SWAGGER_ENABLED says otherwise
  if (cfg.SWAGGER_ENABLED ?? cfg.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, openapi);

  await app.listen(cfg.API_PORT);
  console.log(`API ready on http://localhost:${cfg.API_PORT}  (docs: /docs)`);
}

void bootstrap();
