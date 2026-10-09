import {appendFile} from 'node:fs/promises';
const repository=process.env.GITHUB_REPOSITORY,expected=process.env.EXPECTED_SHA,token=process.env.GH_TOKEN;
if(!repository||!/^[-\w]+\/[-.\w]+$/.test(repository)||!expected?.match(/^[a-f0-9]{40}$/)||!token)throw new Error('CI_GUARD_CONFIGURATION_INVALID');
async function read(path){const r=await fetch('https://api.github.com/repos/'+repository+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});if(!r.ok)throw new Error(`GITHUB_READ_${r.status}`);return r.json();}
const head=await read('/commits/main');const runs=await read(`/actions/workflows/ci.yml/runs?branch=main&head_sha=${expected}&status=success&per_page=30`);
const verified=runs.workflow_runs.some(r=>r.head_sha===expected&&r.conclusion==='success'&&['push','workflow_dispatch'].includes(r.event)&&r.head_repository?.full_name===repository);
const deploy=head.sha===expected&&verified;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`deploy=${deploy}\n`);console.info(deploy?'Verified current main: deployment permitted.':'Deployment skipped: this commit is no longer the verified current main.');
