(() => {
  const $=s=>document.querySelector(s), cfg=window.APP_CONFIG||{};
  const configured=cfg.supabaseUrl&&cfg.supabaseAnonKey&&!cfg.supabaseUrl.includes('YOUR_')&&!cfg.supabaseAnonKey.includes('YOUR_');
  const db=configured?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
  let all=[];
  const loginStatus=$('#loginStatus'), dashStatus=$('#dashStatus');

  function show(el,msg,type='info'){el.textContent=msg;el.className=`status show ${type}`}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
  function withTimeout(promise,ms=15000){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('请求超时')),ms)});
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }
  async function retryNetwork(action,{attempts=3,timeout=12000,label='网络请求'}={}){
    let lastError=null;
    for(let attempt=1;attempt<=attempts;attempt++){
      if(!navigator.onLine){
        lastError=new Error('当前设备处于离线状态');
      }else{
        try{
          const response=await withTimeout(action(),timeout);
          if(response?.error){
            lastError=response.error;
            const status=Number(response.error.status||response.status||0);
            const retryable=isNetworkError(lastError)||status===408||status===429||status>=500;
            if(!retryable)return {data:response,error:lastError};
          }else{
            return {data:response,error:null};
          }
        }catch(err){lastError=err}
      }
      const msg=String(lastError?.message||lastError||'');
      const retryable=isNetworkError(lastError)||msg.includes('超时')||msg.includes('离线');
      if(!retryable)return {data:null,error:lastError};
      if(attempt<attempts)await sleep(attempt===1?700:1400);
    }
    return {data:null,error:lastError};
  }

  function normalizeClassName(v){
    let t=String(v??'').trim().replace(/\s+/g,'').replace(/[０-９]/g,d=>String(d.charCodeAt(0)-65248));
    const m=t.match(/^高([一二三123])[（(]?([0-9]{1,2})[）)]?班?$/);
    if(!m)return t;
    const gradeMap={'1':'一','2':'二','3':'三','一':'一','二':'二','三':'三'};
    return `高${gradeMap[m[1]]}（${Number(m[2])}）班`;
  }

  function filtered(){
    const c=$('#filterClass').value.trim().toLowerCase(),g=$('#filterGroup').value.trim().toLowerCase(),m=$('#filterMedium').value.trim().toLowerCase();
    return all.filter(x=>{
      const cls=normalizeClassName(x.class_name).toLowerCase();
      return(!c||cls.includes(c)||String(x.class_name||'').toLowerCase().includes(c))&&(!g||String(x.group_name||'').toLowerCase().includes(g))&&(!m||String(x.medium||'').toLowerCase().includes(m));
    });
  }

  function render(){
    const rows=filtered(), body=$('#teacherBody'); body.innerHTML='';
    let pts=0; const groups=new Set(), classes=new Set();
    for(const x of rows){
      pts+=(x.measurements||[]).length;
      const cls=normalizeClassName(x.class_name);
      groups.add(`${cls}|${x.group_name}`);classes.add(cls);
      const tr=document.createElement('tr');
      const pairs=(x.measurements||[]).map(p=>`${p.i}°, ${p.r}°`).join('<br>');
      tr.innerHTML=`<td>${new Date(x.created_at).toLocaleString('zh-CN')}</td><td>${esc(cls)}</td><td>${esc(x.group_name)}</td><td>${esc(x.student_code||'—')}</td><td>${esc(x.medium||'—')}</td><td class="measurements">${pairs}</td><td>${esc(x.note||'—')}</td><td><button class="btn danger del" data-id="${x.id}" style="height:30px">删除</button></td>`;
      body.appendChild(tr);
    }
    const media=new Set(rows.map(x=>String(x.medium||'').trim()).filter(Boolean));
    $('#submissionCount').textContent=rows.length;
    $('#groupCount').textContent=groups.size;
    $('#pointCount').textContent=pts;
    $('#mediumCount').textContent=media.size;
    body.querySelectorAll('.del').forEach(b=>b.addEventListener('click',()=>removeOne(b.dataset.id)));
  }

  let loadInProgress=false;
  async function load(){
    if(!db){show(dashStatus,'当前没有可用的云端连接，请检查 config.js。','err');return}
    if(loadInProgress)return;
    loadInProgress=true;
    const refreshBtn=$('#refreshBtn');
    const originalRefreshText=refreshBtn?.textContent||'刷新';
    if(refreshBtn){refreshBtn.disabled=true;refreshBtn.textContent='读取中…'}
    try{
      show(dashStatus,'正在检查教师账号权限…','info');
      const access=await retryNetwork(()=>db.rpc('is_teacher'),{attempts:2,timeout:8000,label:'检查教师权限'});
      if(access.error){
        show(dashStatus,`教师权限检查失败：${friendlyError(access.error,'权限检查')}。请检查网络及 Supabase 配置。`,'err');
        console.error('Teacher permission check failed:',access.error);
        return;
      }
      if(access.data?.data!==true){
        show(dashStatus,'当前账号已登录，但不在教师白名单中，不能读取或删除学生提交。请管理员检查 teacher_allowlist。','err');
        all=[];render();
        return;
      }

      show(dashStatus,'正在读取云端实验数据…','info');
      const result=await retryNetwork(
        ()=>db.from('submissions').select('*').order('created_at',{ascending:false}),
        {attempts:2,timeout:12000,label:'读取实验数据'}
      );
      if(result.error){
        show(dashStatus,`读取失败：${friendlyError(result.error,'读取数据')}。请检查网络、SELECT 权限及 RLS 策略后重试。`,'err');
        console.error('Teacher data query failed:',result.error);
        return;
      }
      const response=result.data||{};
      if(response.error){
        show(dashStatus,`读取失败：${friendlyError(response.error,'读取数据')}`,'err');
        console.error('Teacher data response error:',response.error);
        return;
      }
      all=Array.isArray(response.data)?response.data:[];
      render();
      show(dashStatus,`读取成功：${all.length} 条提交记录。`,'ok');
    }catch(err){
      show(dashStatus,`读取过程中发生程序异常：${friendlyError(err,'读取数据')}。请查看浏览器控制台。`,'err');
      console.error('Unexpected teacher load/render error:',err);
    }finally{
      loadInProgress=false;
      if(refreshBtn){refreshBtn.disabled=false;refreshBtn.textContent=originalRefreshText}
    }
  }

  function errorText(error){
    return String(error?.message||error?.error_description||error?.code||error||'').trim();
  }

  function isCredentialError(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code==='invalid_credentials'||msg.includes('invalid login credentials')||msg.includes('invalid_credentials');
  }

  function isEmailNotConfirmed(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code==='email_not_confirmed'||msg.includes('email not confirmed');
  }

  function isNetworkError(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code.includes('fetch')||code.includes('network')||code.includes('retryable')||
      msg.includes('load failed')||msg.includes('failed to fetch')||msg.includes('network request failed')||
      msg.includes('networkerror')||msg.includes('fetch failed')||msg.includes('connection')||msg.includes('timeout');
  }

  function friendlyError(error,action='操作'){
    if(isCredentialError(error))return '账号或密码错误';
    if(isEmailNotConfirmed(error))return '该教师邮箱尚未完成确认';
    if(isNetworkError(error))return `网络连接异常，${action}请求未能到达服务器`;
    return errorText(error)||`${action}失败`;
  }

  async function login(){
    if(!configured){show(loginStatus,'请先配置 config.js。','err');return}
    const email=$('#email').value.trim(),password=$('#password').value;
    const btn=$('#loginBtn');
    if(!email||!password){show(loginStatus,'请输入教师邮箱和密码。','err');return}

    const originalText=btn.textContent;
    btn.disabled=true;
    let finalError=null;

    try{
      for(let attempt=0;attempt<3;attempt++){
        btn.textContent=attempt===0?'连接中…':`重试中 ${attempt}/2…`;
        if(attempt===0)show(loginStatus,'正在连接教师服务器…','info');
        else show(loginStatus,`网络连接不稳定，正在自动重试（${attempt}/2）…`,'info');

        let result;
        try{
          result=await db.auth.signInWithPassword({email,password});
        }catch(err){
          result={error:err};
        }

        const error=result?.error||null;
        if(!error){
          show(loginStatus,'登录成功，正在读取实验数据…','ok');
          await syncAuth();
          return;
        }

        finalError=error;
        if(isCredentialError(error)){
          show(loginStatus,'账号或密码错误，请检查后重新输入。','err');
          return;
        }
        if(isEmailNotConfirmed(error)){
          show(loginStatus,'该教师邮箱尚未完成确认，请先确认邮箱。','err');
          return;
        }
        if(!isNetworkError(error)){
          show(loginStatus,`登录失败：${friendlyError(error,'登录')}`,'err');
          return;
        }
        if(attempt<2)await sleep(attempt===0?700:1200);
      }

      show(loginStatus,'暂时无法连接 Supabase。请刷新页面或切换网络后再登录；账号和密码本身不一定有问题。','err');
      console.warn('Teacher login network failure after retries:',finalError);
    }finally{
      btn.disabled=false;
      btn.textContent=originalText;
    }
  }

  async function logout(){
    try{
      const {error}=await db.auth.signOut();
      if(error){show(dashStatus,`退出登录失败：${friendlyError(error,'退出登录')}`,'err');return}
      await syncAuth();
    }catch(err){show(dashStatus,`退出登录失败：${friendlyError(err,'退出登录')}，请检查网络。`,'err')}
  }

  async function syncAuth(){
    if(!configured){show(loginStatus,'当前未连接 Supabase。','err');return}
    const result=await retryNetwork(()=>db.auth.getSession(),{attempts:2,label:'恢复登录状态'});
    if(result.error){
      show(loginStatus,`暂时无法确认登录状态：${friendlyError(result.error,'恢复登录状态')}。请检查网络后刷新页面。`,'err');
      return;
    }
    const session=result.data?.data?.session;
    const on=!!session;
    $('#loginCard').style.display=on?'none':'block';
    $('#dashboard').style.display=on?'block':'none';
    $('#logoutBtn').style.display=on?'inline-flex':'none';
    if(on)await load();
  }

  async function removeOne(id){
    if(!confirm('确定删除这次提交吗？'))return;
    const rowButton=[...document.querySelectorAll('.del')].find(b=>String(b.dataset.id)===String(id));
    if(rowButton){rowButton.disabled=true;rowButton.textContent='删除中…'}
    show(dashStatus,'正在向数据库确认删除…','info');
    try{
      const response=await withTimeout(
        db.from('submissions').delete().eq('id',id).select('id'),
        12000
      );
      if(response?.error){
        show(dashStatus,`删除失败：${friendlyError(response.error,'删除')}。请检查教师白名单及 DELETE/SELECT RLS 策略。`,'err');
        console.error('Teacher delete response error:',response.error);
        if(rowButton){rowButton.disabled=false;rowButton.textContent='删除'}
        return;
      }
      const deletedRows=Array.isArray(response?.data)?response.data:[];
      const wasDeleted=deletedRows.some(row=>String(row.id)===String(id));
      if(!wasDeleted){
        // 不把“0行受影响”误报为成功；重新查询确认记录是否仍存在。
        await load();
        const stillExists=all.some(row=>String(row.id)===String(id));
        show(dashStatus,stillExists
          ?'删除未成功：数据库中仍存在这条记录。请检查 teacher_allowlist 和 submissions 的 DELETE RLS 策略。'
          :'数据库中已找不到这条记录，列表已同步。','err');
        return;
      }
      all=all.filter(row=>String(row.id)!==String(id));
      render();
      show(dashStatus,'数据库已确认删除该条记录。','ok');
    }catch(err){
      show(dashStatus,`删除请求异常：${friendlyError(err,'删除')}。请先刷新列表确认结果，不要连续重复点击。`,'err');
      console.error('Unexpected teacher delete error:',err);
      if(rowButton){rowButton.disabled=false;rowButton.textContent='删除'}
    }
  }

  function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  function download(name,lines){const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function safeFilePart(v){return String(v||'').trim().replace(/[\/:*?"<>|]/g,'-').replace(/\s+/g,'').slice(0,50)||'未命名班级'}
  function classFilePrefix(rows){const classes=[...new Set(rows.map(x=>normalizeClassName(x.class_name)).filter(Boolean))];if(classes.length===1)return safeFilePart(classes[0]);const typed=$('#filterClass').value.trim();if(typed)return safeFilePart(normalizeClassName(typed));return classes.length>1?'多班级':'未命名班级'}
  function analysisCsv(){const rows=filtered();if(!rows.length){show(dashStatus,'当前筛选条件下没有可下载的数据。','err');return}const lines=['数据组,入射角i(°),折射角r(°)'];for(const x of rows){const group=x.group_name||'未命名组';for(const p of x.measurements||[])lines.push([group,p.i,p.r].map(csvCell).join(','))}download(`${classFilePrefix(rows)}_光的折射分析数据.csv`,lines)}
  function detailCsv(){const rows=filtered();if(!rows.length){show(dashStatus,'当前筛选条件下没有可下载的数据。','err');return}const lines=['提交ID,提交时间,班级,组别,学生,介质,备注,入射角i(°),折射角r(°)'];for(const x of rows){for(const p of x.measurements||[])lines.push([x.id,x.created_at,normalizeClassName(x.class_name),x.group_name,x.student_code||'',x.medium||'',x.note||'',p.i,p.r].map(csvCell).join(','))}download(`${classFilePrefix(rows)}_光的折射详细数据.csv`,lines)}

  $('#loginBtn').addEventListener('click',login);
  $('#password').addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('#loginBtn').disabled)login()});
  $('#logoutBtn').addEventListener('click',logout);
  $('#refreshBtn').addEventListener('click',load);
  $('#analysisCsvBtn').addEventListener('click',analysisCsv);
  $('#detailCsvBtn').addEventListener('click',detailCsv);
  ['filterClass','filterGroup','filterMedium'].forEach(id=>$('#'+id).addEventListener('input',render));
  if(configured){
    db.auth.onAuthStateChange((event,session)=>{
      // Auth 回调内不再调用 getSession()，避免 Supabase Auth 锁重入。
      if(event==='SIGNED_IN'&&session){
        setTimeout(()=>{
          $('#loginCard').style.display='none';
          $('#dashboard').style.display='block';
          $('#logoutBtn').style.display='inline-flex';
          load().catch(err=>show(dashStatus,`读取异常：${friendlyError(err,'读取数据')}`,'err'));
        },0);
      }else if(event==='SIGNED_OUT'){
        setTimeout(()=>{
          $('#loginCard').style.display='block';
          $('#dashboard').style.display='none';
          $('#logoutBtn').style.display='none';
          all=[];render();
        },0);
      }
    });
  }
  syncAuth().catch(err=>show(loginStatus,`登录状态检查失败：${friendlyError(err,'恢复登录状态')}`,'err'));
  window.addEventListener('offline',()=>show($('#dashboard').style.display==='block'?dashStatus:loginStatus,'网络已断开。请恢复网络后重试，页面数据不会主动清空。','err'));
  window.addEventListener('online',()=>show($('#dashboard').style.display==='block'?dashStatus:loginStatus,'网络已恢复，可以重新尝试操作。','ok'));
})();
