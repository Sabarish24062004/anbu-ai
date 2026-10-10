import 'dotenv/config';

// Tests always run against the separate test database, never the development one.
process.env['NODE_ENV'] = 'test';
if (!process.env['DATABASE_URL_TEST']) {
  throw new Error('DATABASE_URL_TEST must be set (see .env.example)');
}
process.env['DATABASE_URL'] = process.env['DATABASE_URL_TEST'];
process.env['LOG_LEVEL'] = 'silent';
process.env['REMINDER_WORKER_ENABLED'] = 'false';
