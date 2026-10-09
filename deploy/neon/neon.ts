import {defineConfig} from '@neon/config/v1';
const keys=['PUBLIC_API_URL','AUTH_JWT_SECRET_BASE64','INTERNAL_WORKER_SECRET','SCHEDULE_PATH_TOKEN','CORS_ORIGINS','OPENAI_API_KEY','OPENAI_MODEL','PAID_EXECUTION_ENABLED','NORMALIZER_VERIFIED','EGRESS_VERIFIED','NORMALIZER_VERSION','VERIFIED_CLIENT_IP_HEADER'];
const env=Object.fromEntries(keys.map(key=>[key,process.env[key]??'']));
if(!env.SCHEDULE_PATH_TOKEN||env.SCHEDULE_PATH_TOKEN.length<32)throw new Error('SCHEDULE_PATH_TOKEN_REQUIRED');
export default defineConfig({
  auth:false,dataApi:false,aiGateway:false,
  buckets:{'search-images':{access:'private'}},
  functions:{api:{name:'SSANDEVISTHAN API',source:'../../.cache/neon-bundle',bundler:'none',env:{...env,INPUT_BUCKET:'search-images'}}},
  triggers:{'search-sweep':{type:'schedule',function:'api',cron:'* * * * *',functionPath:`/internal/schedule/${env.SCHEDULE_PATH_TOKEN}`,enabled:true}},
});
