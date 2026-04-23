import 'node:process';
import dotenv from 'dotenv';
import { startServer } from './server.js';
import { startWorker } from './workers/index.js';

dotenv.config();

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);

const { httpServer } = await startServer();
startWorker();

httpServer.listen(PORT, () => {
  console.log(`🚀  API ready at http://localhost:${PORT}/graphql`);
  console.log(`⚡  WebSocket subscriptions at ws://localhost:${PORT}/graphql`);
});
