import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const sb = createClient('https://wabpybyaqiatelaecpal.supabase.co', 'sb_publishable_jS_K1IMhLvuib6zyxPnMbw_u1W0pjbZ');
const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const orderId = new URLSearchParams(location.search).get('order');
if (orderId) {
  $('order-result').hidden = false;
  const update = async () => {
    try {
      const r = await fetch('/api/order?id=' + encodeURIComponent(orderId),{cache:'no-store'});
      const order = await r.json();
      if (!r.ok) throw Error(order.error || 'Pedido não encontrado');
      const labels = {approved:'Pagamento aprovado',pending:'Aguardando confirmação',created:'Aguardando confirmação',rejected:'Pagamento recusado',cancelled:'Pagamento cancelado',refunded:'Pagamento estornado',charged_back:'Pagamento contestado'};
      $('order-message').textContent = `${labels[order.status] || 'Em análise'} · ${money(order.amount_cents)}`;
      if (['created','pending'].includes(order.status)) setTimeout(update,8000);
    } catch (e) { $('order-message').textContent=e.message; }
  }; update();
}
const { data, error } = await sb.from('products').select('id,title,price_cents').eq('active',true).order('created_at',{ascending:false});
if (error) $('catalog').textContent='Não foi possível carregar os produtos.';
else if (!data.length) $('catalog').textContent='Nenhum produto publicado ainda.';
else $('catalog').replaceChildren(...data.filter(product => !location.hash || location.hash.slice(1) === product.id).map(product => {
  const card=document.createElement('article');card.className='card';
  const title=document.createElement('h2');title.textContent=product.title;
  const price=document.createElement('strong');price.textContent=money(product.price_cents);
  const button=document.createElement('button');button.textContent='Comprar';
  button.onclick=async()=>{
    button.disabled=true;$('message').textContent='Criando checkout seguro…';
    try {
      const response=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:product.id,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Checkout indisponível');
      location.assign(result.checkoutUrl);
    } catch(e){$('message').textContent=e.message;button.disabled=false;}
  };card.append(title,price,button);return card;
}));
