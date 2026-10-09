export const publicSettingKeys=Object.freeze(['PUBLIC_API_URL','CORS_ORIGINS','OPENAI_MODEL','NORMALIZER_VERSION','NORMALIZER_VERIFIED','EGRESS_VERIFIED','INPUT_BUCKET','PAID_EXECUTION_ENABLED','VERIFIED_CLIENT_IP_HEADER']);
export const requiredSecretReferences=Object.freeze(['AUTH_JWT_SECRET_BASE64','INTERNAL_WORKER_SECRET','SCHEDULE_PATH_TOKEN','OPENAI_API_KEY']);
const fail=()=>{throw Error('DEPLOYMENT_SETTINGS_INVALID');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function origin(value){try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password&&!url.hostname.endsWith('.');}catch{return false;}}
export function validatePublicDeploymentSettings(value){
 if(!object(value)||Object.keys(value).length!==publicSettingKeys.length||publicSettingKeys.some(key=>typeof value[key]!=='string'||value[key].length>2048))fail();
 const checks={PUBLIC_API_URL:origin,CORS_ORIGINS:v=>v.length>0&&v.split(',').every(origin),OPENAI_MODEL:v=>v==='gpt-6.1-sol',NORMALIZER_VERSION:v=>v==='sharp-webp-v3-1',NORMALIZER_VERIFIED:v=>['true','false'].includes(v),EGRESS_VERIFIED:v=>['true','false'].includes(v),INPUT_BUCKET:v=>v==='search-images',PAID_EXECUTION_ENABLED:v=>['true','false'].includes(v),VERIFIED_CLIENT_IP_HEADER:v=>v===''||/^[a-z][a-z0-9-]{0,63}$/.test(v)};
 if(Object.entries(checks).some(([key,check])=>!check(value[key])))fail();
 return Object.fromEntries(publicSettingKeys.map(key=>[key,value[key]]));
}
export function validateBackendSettings(value){
 if(!object(value)||Object.keys(value).some(key=>![...publicSettingKeys,...requiredSecretReferences].includes(key)))fail();
 const publicSettings=validatePublicDeploymentSettings(Object.fromEntries(publicSettingKeys.map(key=>[key,value[key]])));
 const jwt=value.AUTH_JWT_SECRET_BASE64;
 if(typeof jwt!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(jwt)||Buffer.from(jwt,'base64').length!==32||Buffer.from(jwt,'base64').toString('base64')!==jwt)fail();
 for(const key of ['INTERNAL_WORKER_SECRET','SCHEDULE_PATH_TOKEN'])if(typeof value[key]!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(value[key]))fail();
 if(value.INTERNAL_WORKER_SECRET===value.SCHEDULE_PATH_TOKEN)fail();
 if(value.OPENAI_API_KEY!==undefined&&(typeof value.OPENAI_API_KEY!=='string'||(value.OPENAI_API_KEY!==''&&!/^sk-(?:proj-)?[A-Za-z0-9_-]{20,512}$/.test(value.OPENAI_API_KEY))))fail();
 if(publicSettings.PAID_EXECUTION_ENABLED==='true'&&(!value.OPENAI_API_KEY||publicSettings.NORMALIZER_VERIFIED!=='true'||publicSettings.EGRESS_VERIFIED!=='true'))fail();
 return {...publicSettings,AUTH_JWT_SECRET_BASE64:jwt,INTERNAL_WORKER_SECRET:value.INTERNAL_WORKER_SECRET,SCHEDULE_PATH_TOKEN:value.SCHEDULE_PATH_TOKEN,...(value.OPENAI_API_KEY!==undefined?{OPENAI_API_KEY:value.OPENAI_API_KEY}:{})};
}
export function publicDeploymentSettings(value){const settings=validateBackendSettings(value);return Object.fromEntries(publicSettingKeys.map(key=>[key,settings[key]]));}
