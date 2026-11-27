import { refreshGateway } from './gateway-admin.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const url='https://wabpybyaqiatelaecpal.supabase.co';
const key='sb_publishable_jS_K1IMhLvuib6zyxPnMbw_u1W0pjbZ';
const sb=createClient(url,key);
const $=id=>document.getElementById(id);
const msg=text=>{$('message').textContent=text};
let current=null,recovering=false;
async function refresh(){
 const {data:{user},error}=await sb.auth.getUser();
 current=error?null:user;
 $('auth').hidden=!!current||recovering;$('dashboard').hidden=!current||recovering;$('recovery').hidden=!recovering;$('identity').textContent=current?.email||'';
 if(!current||recovering)return
 const {data:profile,error:profileError}=await sb.from('profiles').select('role,account_type,seller_status').eq('id',current.id).single();
 if(profileError){msg(profileError.message);return}
 const isAdmin=profile.role==='ADMIN',isSeller=profile.account_type==='SELLER';
 $('admin').hidden=!isAdmin;$('gateway-admin').hidden=!isAdmin;
 $('seller-panel').hidden=isAdmin||!isSeller;$('buyer-panel').hidden=isAdmin||isSeller;
 $('dashboard-title').textContent=isAdmin?'Minha wallet':isSeller?'Minha wallet · vendedor':'Minha wallet';
 $('dashboard-hint').textContent=isAdmin?'A carteira cripto está em desenvolvimento. As ferramentas de venda de teste ficam abaixo.':isSeller?'Cadastro em análise. A liberação de cobranças exige conectar sua própria conta do provedor.':'A criação da carteira cripto ainda está em desenvolvimento.';
 if(profile.role==='ADMIN')refreshGateway(sb,current);

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
  status.textContent=google.disabled?'Google ainda não foi ativado no Supabase. Entre por e-mail e senha.':'Você também pode entrar com Google.';
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
  msg(error.message==='Invalid login credentials'?'Credenciais inválidas. Confira o e-mail e a senha.':error.message||'Não foi possível entrar.');
 }finally{button.disabled=false;}
};
function authTab(signup){$('auth-form').hidden=signup;$('signup-form').hidden=!signup;$('show-login').classList.toggle('active',!signup);$('show-signup').classList.toggle('active',signup);$('auth').querySelector('h2').textContent=signup?'Crie sua conta':'Acesse sua conta';}
$('show-login').onclick=()=>authTab(false);
$('show-signup').onclick=()=>authTab(true);
document.querySelector('.hero-actions a[href="#auth"]').addEventListener('click',()=>authTab(true));
$('signup-form').onsubmit=async e=>{
 e.preventDefault();const form=e.currentTarget,button=e.submitter;button.disabled=true;
 try{
  const f=new FormData(form),password=String(f.get('password'));
  if(password!==f.get('confirm_password'))throw Error('As senhas não coincidem.');
  const account_type=$('signup-type').value;
  if(!['BUYER','SELLER'].includes(account_type))throw Error('Tipo de conta inválido.');
  const {data,error}=await sb.auth.signUp({email:String(f.get('email')).trim(),password,options:{emailRedirectTo:location.origin,data:{account_type}}});
  if(error)throw error;
  form.reset();authTab(false);
  msg(data.session?'Conta criada. Você já pode entrar.':'Confira seu e-mail para confirmar o cadastro antes de entrar.');
 }catch(error){msg(error.message||'Não foi possível criar a conta.');}
 finally{button.disabled=false;}
};
$('forgot').onclick=async()=>{
 const email=$('auth-form').elements.email.value.trim();
 if(!email||!$('auth-form').elements.email.checkValidity()){msg('Informe seu e-mail para receber o link de recuperação.');$('auth-form').elements.email.focus();return;}
 const button=$('forgot');button.disabled=true;
 try{
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
  if(error)throw error;
  msg('Se esta conta existir, enviaremos um link de recuperação para esse e-mail.');
 }catch(error){msg(error.code==='over_email_send_rate_limit'||/email rate limit exceeded/i.test(error.message||'')?'O serviço de e-mail do Supabase atingiu a cota do projeto. Use um link de recuperação já recebido ou aguarde a renovação da cota; para envio contínuo, configure SMTP próprio.':error.message||'Não foi possível enviar o link.');}
 finally{button.disabled=false;}
};
$('recovery-form').onsubmit=async e=>{
 e.preventDefault();const form=e.currentTarget;
 const password=form.elements.new_password.value,confirm=form.elements.confirm_password.value;
 if(password!==confirm){msg('As senhas não coincidem.');return;}
 const button=e.submitter;button.disabled=true;
 try{
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw Error('Link expirado. Solicite um novo link de recuperação.');
  const {error}=await sb.auth.updateUser({password});
  if(error)throw error;
  form.reset();recovering=false;await sb.auth.signOut();
  msg('Senha alterada. Entre com a nova senha.');
  refresh();
 }catch(error){msg(error.message||'Não foi possível alterar a senha.');}
 finally{button.disabled=false;}
};
document.querySelectorAll('[data-provider]').forEach(b=>b.onclick=async()=>{
 if(b.disabled)return;
 const {error}=await sb.auth.signInWithOAuth({provider:b.dataset.provider,options:{redirectTo:location.origin}});
 if(error)msg(error.message);
});
providerAvailability();
$('logout').onclick=async()=>{await sb.auth.signOut();refresh()};
$('set-password').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget, password=form.elements.new_password.value;
 if(password!==form.elements.confirm_password.value){msg('As senhas não coincidem.');return;}
 const button=e.submitter;button.disabled=true;
 try{
  const {data:{user},error:identityError}=await sb.auth.getUser();
  if(identityError||!user)throw Error('Sessão expirada. Entre novamente.');
  const {data:profile,error:roleError}=await sb.from('profiles').select('role').eq('id',user.id).single();
  if(roleError||profile?.role!=='ADMIN')throw Error('Somente o administrador pode usar este formulário.');
  const {error}=await sb.auth.updateUser({password});
  if(error)throw error;
  form.reset();
  await sb.auth.signOut();
  msg('Senha alterada. Entre novamente por e-mail e senha para confirmar.');
  await refresh();
 }catch(error){msg(error.message||'Não foi possível definir a senha. Entre novamente com Google e tente de novo.');}
 finally{button.disabled=false;}
};

sb.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')recovering=true;setTimeout(refresh,0)});refresh();
