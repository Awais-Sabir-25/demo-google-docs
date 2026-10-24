const { openDb } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp(openDb());
app.set('trust proxy', 1);
app.listen(port, () => console.log(`Ajaia Docs listening on http://localhost:${port}`));
