import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const url='https://wabpybyaqiatelaecpal.supabase.co';
const key='sb_publishable_jS_K1IMhLvuib6zyxPnMbw_u1W0pjbZ';
const api=globalThis.CONFIDENCE_API_URL || '';
const sb=createClient(url,key);
const $=id=>document.getElementById(id);
const msg=text=>{$('message').textContent=text};
let current=null,subscription=null;
async function refresh(){
 const {data:{user},error}=await sb.auth.getUser();
 current=error?null:user;
 $('auth').hidden=!!current;$('dashboard').hidden=!current;$('identity').textContent=current?.email||'';
 if(!current){subscription?.unsubscribe();subscription=null;return}
 const [accounts,transactions,profile]=await Promise.all([
  sb.from('accounts').select('id,currency,balance').eq('owner_id',current.id).order('currency'),
  sb.from('transactions').select('id,amount,currency,created_at,source_account,destination_account').order('created_at',{ascending:false}).limit(30),
  sb.from('profiles').select('role').eq('id',current.id).single()
 ]);
 for(const x of [accounts,transactions,profile])if(x.error){msg(x.error.message);return}
 $('accounts').replaceChildren(...accounts.data.map(a=>{const e=document.createElement('div');e.className='card';const s=document.createElement('small'),b=document.createElement('strong'),c=document.createElement('code');s.textContent='CARTEIRA '+a.currency;b.textContent=new Intl.NumberFormat('pt-BR',{style:'currency',currency:a.currency}).format(Number(a.balance));c.textContent=a.id;c.title='Clique para copiar';c.onclick=()=>navigator.clipboard.writeText(a.id).then(()=>msg('ID copiado.'));e.append(s,b,c);return e}));
 $('transfer').elements.source.replaceChildren(...accounts.data.map(a=>new Option(a.currency+' · '+a.id.slice(0,8),a.id)));
 $('transactions').replaceChildren(...transactions.data.map(t=>{const e=document.createElement('article'),l=document.createElement('div'),r=document.createElement('strong');const own=accounts.data.some(a=>a.id===t.source_account);l.textContent=own?'Saída':'Entrada';const d=document.createElement('small');d.textContent=' · '+new Date(t.created_at).toLocaleString('pt-BR');l.append(d);r.textContent=(own?'−':'+')+new Intl.NumberFormat('pt-BR',{style:'currency',currency:t.currency}).format(Number(t.amount));e.append(l,r);return e}));
 if(!transactions.data.length)$('transactions').textContent='Nenhuma movimentação ainda.';
 $('admin').hidden=profile.data.role!=='ADMIN';
 if(profile.data.role==='ADMIN'){const a=await sb.from('admin_audit').select('*').order('seq',{ascending:false}).limit(20);if(!a.error)$('audit').replaceChildren(...a.data.map(x=>{const e=document.createElement('article');e.textContent='#'+x.seq+' · '+x.transaction_id+' · '+x.payload_hash;e.title='HMAC: '+x.hmac_signature;return e}))}
 if(!subscription)subscription=sb.channel('wallet-change').on('postgres_changes',{event:'*',schema:'public',table:'accounts',filter:'owner_id=eq.'+current.id},()=>refresh()).on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>refresh()).subscribe();
}
async function providerAvailability(){
 const status=$('provider-status'),google=document.querySelector('[data-provider="google"]'),apple=document.querySelector('[data-provider="apple"]');
 try{
  const r=await fetch(url+'/auth/v1/settings',{headers:{apikey:key}});
  if(!r.ok)throw Error('Não foi possível consultar os provedores.');
  const settings=await r.json();
  google.disabled=settings.external?.google!==true;
  apple.hidden=settings.external?.apple!==true;
  apple.disabled=settings.external?.apple!==true;
  status.textContent=google.disabled?'Google ainda não foi ativado no Supabase. Use Criar conta com e-mail e senha.':'Você também pode entrar com Google.';
 }catch(error){google.disabled=true;apple.hidden=true;status.textContent='Google indisponível por enquanto. Use e-mail e senha.';}
}
$('auth-form').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{
  const f=new FormData(e.target);
  const {error}=await sb.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});
  if(error)throw error;
  msg('Sessão iniciada.');await refresh();
 }catch(error){
  msg(error.message==='Invalid login credentials'?'Credenciais inválidas. Se ainda não criou sua conta, clique em Criar conta.':error.message||'Não foi possível entrar.');
 }finally{button.disabled=false;}
};
$('signup').onclick=async e=>{
 const form=$('auth-form');if(!form.reportValidity())return;
 const button=e.currentTarget;button.disabled=true;
 try{
  const f=new FormData(form);
  const {data,error}=await sb.auth.signUp({email:f.get('email'),password:f.get('password'),options:{emailRedirectTo:location.origin}});
  if(error)throw error;
  msg(data.session?'Conta criada e sessão iniciada.':'Cadastro solicitado. Abra o link de confirmação enviado ao seu e-mail e depois entre.');
  if(data.session)await refresh();
 }catch(error){msg(error.message||'Não foi possível criar a conta.');}finally{button.disabled=false;}
};
document.querySelectorAll('[data-provider]').forEach(b=>b.onclick=async()=>{
 if(b.disabled)return;
 const {error}=await sb.auth.signInWithOAuth({provider:b.dataset.provider,options:{redirectTo:location.origin}});
 if(error)msg(error.message);
});
providerAvailability();
$('logout').onclick=async()=>{await sb.auth.signOut();refresh()};
$('transfer').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{if(!api)throw Error('API Java não configurada. Defina CONFIDENCE_API_URL em config.js e publique o backend.');const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Sessão expirada.');const f=new FormData(e.target);const id=crypto.randomUUID();const r=await fetch(api.replace(/\/$/,'')+'/api/transfer',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'X-Idempotency-Key':id},body:JSON.stringify({source:f.get('source'),destination:f.get('destination'),amount:f.get('amount')})});const x=await r.json();if(!r.ok)throw Error(x.error||'Transferência recusada');msg('Transferência registrada: '+x.transactionId);e.target.reset();refresh()}catch(err){msg(err.message)}finally{b.disabled=false}};
const apiStatus=$('api-status');if(!api){apiStatus.textContent='Transferências temporariamente indisponíveis: o servidor financeiro ainda não foi publicado.';$('transfer').querySelector('button[type="submit"]').disabled=true;}else{apiStatus.textContent='API financeira conectada.';}
sb.auth.onAuthStateChange(()=>setTimeout(refresh,0));refresh();