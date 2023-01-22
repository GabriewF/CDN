import { Hono } from 'hono';
import { cache } from 'hono/cache'
import { sha256 } from 'hono/utils/crypto';
import { KVNamespace } from '@cloudflare/workers-types';

interface Env { BUCKET: KVNamespace };
const app = new Hono<{ Bindings: Env }>();

// GET - Index
app.get('/', (c) => c.text('Hello World!'));
app.use('/:id', cache({ cacheName: 'cdn', cacheControl: 'max-age=604800, s-maxage=604800, immutable' }))

/**
 * @name GET - Data
 * @description This route get data from Cloudflare KV, and return to the user
 */
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const bucket = c.env['BUCKET'];

  const list = await bucket.list();

  interface Metadata {
    shasum: string;
    type: string;
  };
  
  const data = await bucket.getWithMetadata<Metadata>(id, 'stream');
  if (!data.value) return c.text('This key don\'t exist on KV namespace (KV_KEY_DONT_EXIST)', 400);

  const type = data.metadata?.type;
  
  return c.body(data.value, 200, {
    'Content-Type': type,
    'Content-Encoding': 'gzip',
  });
});

/**
 * @name PUT - Data
 * @description This route put data into Cloudflare KV, and return the url to the user
 */
app.put('/', async (c, next) => {
  const formData = await c.req.formData();
  const bucket = c.env['BUCKET'];

  if (!formData.has('data')) return c.text('Invalid Parameters (data)', 400);
  const data = formData.get('data') as File;

  const stream = data.stream();
  const arrayBuffer = await data.arrayBuffer();
  
  const shasum = await sha256(arrayBuffer);
  const id = shasum.substring(0, 7);

  await bucket.put(id, stream, {
    metadata: {
      shasum: shasum,
      type: data.type,
    },
  });

  const url = new URL(id, c.req.url);
  const resBody = {
    accessUrl: url,
    metadata: {
      resourceId: id,
      resourceShasum: shasum
    }
  };

  return c.json(resBody, 201, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  });
});

export default app;