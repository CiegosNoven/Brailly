import 'dotenv/config';
import express from 'express';
import {webApi} from '../server/web-api.js';
const app=express();
app.set('trust proxy',1);
app.use('/api',webApi);
export default app;
