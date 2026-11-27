const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export async function refreshGateway(sb,user) {
 const products=document.getElementById('products'),orders=document.getElementById('orders');
 const [p,o]=await Promise.all([
   sb.from('products').select('id,title,price_cents,active').eq('seller_id',user.id).order('created_at',{ascending:false}),
   sb.from('checkout_orders').select('id,status,amount_cents,created_at').eq('seller_id',user.id).order('created_at',{ascending:false}).limit(20)
 ]);
 if(p.error||o.error){document.getElementById('message').textContent=(p.error||o.error).message;return;}
 products.replaceChildren(...p.data.map(item=>{
   const row=document.createElement('article'),info=document.createElement('span'),link=document.createElement('button');
   info.textContent=`${item.title} · ${money(item.price_cents)} · ${item.active?'Ativo':'Pausado'}`;
   link.textContent='Copiar link';link.className='secondary';
   link.onclick=()=>navigator.clipboard.writeText(`${location.origin}/checkout.html#${item.id}`).then(()=>document.getElementById('message').textContent='Link copiado.');
   const toggle=document.createElement('button');toggle.className='secondary';toggle.textContent=item.active?'Pausar':'Ativar';
   toggle.onclick=async()=>{toggle.disabled=true;const {error}=await sb.from('products').update({active:!item.active}).eq('id',item.id);if(error)document.getElementById('message').textContent=error.message;else refreshGateway(sb,user);};
   row.append(info,link,toggle);return row;
 }));
 if(!p.data.length)products.textContent='Nenhum produto ainda.';
 orders.replaceChildren(...o.data.map(item=>{
   const row=document.createElement('article');row.textContent=`${new Date(item.created_at).toLocaleString('pt-BR')} · ${money(item.amount_cents)} · ${item.status} · ${item.id}`;return row;
 }));
 if(!o.data.length)orders.textContent='Nenhum pedido ainda.';
 const form=document.getElementById('new-product');
 form.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;
   try {const f=new FormData(form),price=String(f.get('price')).trim();if(!/^\d{1,7},\d{2}$/.test(price))throw Error('Use o preço no formato 49,90.');
     const amount=Number(price.replace(',',''));if(amount<100||amount>100000000)throw Error('Preço fora do limite.');
     const {error}=await sb.from('products').insert({seller_id:user.id,title:String(f.get('title')).trim(),price_cents:amount});if(error)throw error;
     form.reset();document.getElementById('message').textContent='Produto publicado.';refreshGateway(sb,user);
   }catch(error){document.getElementById('message').textContent=error.message;}finally{button.disabled=false;}
 };
}
