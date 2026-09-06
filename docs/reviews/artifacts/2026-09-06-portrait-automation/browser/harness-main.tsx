import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PatternExperience} from '/@fs/home/henry/patternlike-app/.worktrees/portrait-explorer/apps/web/src/components/PatternExperience.tsx';
import '/@fs/home/henry/patternlike-app/.worktrees/portrait-explorer/apps/web/src/styles.css';
const root=createRoot(document.getElementById('root')!);
window.accountCanaryUnmount=()=>root.unmount();
function AccountHarness(){const [chartId,setChartId]=useState('cht_automated_canary');window.accountCanaryReplaceChart=setChartId;return <React.StrictMode><div style={{maxWidth:1400,margin:'0 auto',padding:'20px 16px'}}><header style={{marginBottom:24}}><h1 style={{fontSize:28}}>Automated portrait verification</h1><p>Fictional reading and automatically generated models in the account component. Account API responses are intercepted for this local check.</p></header><PatternExperience chartId={chartId} onUnauthorized={()=>{window.accountCanaryUnauthorized=true;root.unmount();}} /></div></React.StrictMode>;}
root.render(<AccountHarness/>);
