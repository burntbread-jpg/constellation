import worker from '../../dist/server/index.js';

const handle = request => worker.fetch(request, process.env);

export {
  handle as PATCH,
  handle as DELETE
};
