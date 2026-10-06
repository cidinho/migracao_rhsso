import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  at: number;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;

export interface TestServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startServer(handler: Handler): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        at: Date.now(),
      };
      requests.push(recorded);
      Promise.resolve(handler(recorded, res)).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, requests, close: () => close(server) };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

export interface TestProxy {
  url: string;
  hits: string[];
  close(): Promise<void>;
}

/** Proxy HTTP mínimo: suporta túnel CONNECT e requisições com URI absoluta. */
export async function startProxy(): Promise<TestProxy> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const target = new URL(req.url ?? '');
    const upstream = httpRequest(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  server.on('connect', (req, clientSocket, head) => {
    hits.push(`CONNECT ${req.url}`);
    const [host, port] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, hits, close: () => close(server) };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}
