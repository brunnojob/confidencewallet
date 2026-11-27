package store.brunnodev.wallet;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import com.zaxxer.hikari.*;
import java.io.*;
import java.math.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
public final class Main {
 static final ObjectMapper JSON=new ObjectMapper();
 static final String ZERO="0".repeat(64);
 final HikariDataSource db;
 final NativeAudit audit;
 final JwtAuth auth;
 final String origin;
 final HttpClient http=HttpClient.newHttpClient();
 final ConcurrentHashMap<String,Quote> quotes=new ConcurrentHashMap<>();
 final ConcurrentHashMap<UUID,Deque<Long>> attempts=new ConcurrentHashMap<>();
 record Quote(String rate,long until){}
 Main() throws Exception {
  String url=env("DATABASE_URL"),password=env("DATABASE_PASSWORD");
  var config=new HikariConfig();config.setJdbcUrl(url);config.setUsername(env("DATABASE_USER"));config.setPassword(password);config.setMaximumPoolSize(8);config.setAutoCommit(false);config.setConnectionTimeout(10000);config.setPoolName("wallet");
  db=new HikariDataSource(config);audit=new NativeAudit(env("AUDIT_HMAC_KEY_HEX"));auth=new JwtAuth(env("SUPABASE_URL"));origin=env("ALLOWED_ORIGIN");
 }
 static String env(String key){var v=System.getenv(key);if(v==null||v.isBlank())throw new IllegalArgumentException("Missing "+key);return v;}
 public static void main(String[] args)throws Exception{
  var app=new Main();int port=Integer.parseInt(System.getenv().getOrDefault("PORT","8080"));
  var server=HttpServer.create(new InetSocketAddress("0.0.0.0",port),64);
  server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
  server.createContext("/health",e->app.respond(e,200,Map.of("status","ok")));
  server.createContext("/api/transfer",app::transfer);
  server.createContext("/api/fx",app::fx);
  server.createContext("/api/audit",app::auditReport);
  server.start();
 }
 void respond(HttpExchange e,int status,Object body)throws IOException{
  var h=e.getResponseHeaders();h.set("Content-Type","application/json; charset=utf-8");h.set("Cache-Control","no-store");h.set("X-Content-Type-Options","nosniff");h.set("Access-Control-Allow-Origin",origin);h.set("Vary","Origin");h.set("Access-Control-Allow-Headers","Authorization,Content-Type,X-Idempotency-Key");h.set("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  byte[] bytes=JSON.writeValueAsBytes(body);e.sendResponseHeaders(status,bytes.length);try(var stream=e.getResponseBody()){stream.write(bytes);}
 }
 boolean preflight(HttpExchange e)throws IOException{String requestOrigin=e.getRequestHeaders().getFirst("Origin");if(requestOrigin!=null&&!origin.equals(requestOrigin)){respond(e,403,Map.of("error","Origin denied"));return true;}if("OPTIONS".equals(e.getRequestMethod())){respond(e,204,Map.of());return true;}return false;}
 UUID actor(HttpExchange e)throws Exception{return auth.authenticate(e.getRequestHeaders().getFirst("Authorization"));}
 void rate(UUID actor){var now=System.currentTimeMillis();var q=attempts.computeIfAbsent(actor,x->new ConcurrentLinkedDeque<>());synchronized(q){while(!q.isEmpty()&&q.peekFirst()<now-60000)q.pollFirst();if(q.size()>=10)throw new SecurityException("Rate limit exceeded");q.addLast(now);}}
 void transfer(HttpExchange e)throws IOException{
  try{
   if(preflight(e))return;if(!"POST".equals(e.getRequestMethod())){respond(e,405,Map.of("error","Method"));return;}
   UUID actor=actor(e);rate(actor);
   String keyHeader=e.getRequestHeaders().getFirst("X-Idempotency-Key");UUID key=UUID.fromString(keyHeader);
   byte[] bytes=e.getRequestBody().readNBytes(4097);if(bytes.length>4096)throw new IllegalArgumentException("Body too large");
   JsonNode body=JSON.readTree(bytes);
   UUID source=UUID.fromString(body.path("source").asText()),destination=UUID.fromString(body.path("destination").asText());
   BigDecimal amount=new BigDecimal(body.path("amount").asText()).setScale(4,RoundingMode.UNNECESSARY);
   if(amount.signum()<=0)throw new IllegalArgumentException("Amount must be positive");
   UUID result=transferAtomic(actor,source,destination,amount,key);
   respond(e,200,Map.of("transactionId",result.toString()));
  }catch(SecurityException x){respond(e,401,Map.of("error",x.getMessage()));}catch(IllegalArgumentException x){respond(e,400,Map.of("error",x.getMessage()));}catch(Exception x){System.err.println("transfer error: "+x.getClass().getSimpleName());respond(e,409,Map.of("error","Transfer denied or audit integrity failed"));}
 }
 UUID transferAtomic(UUID actor,UUID source,UUID dest,BigDecimal amount,UUID key)throws Exception{
  try(var c=db.getConnection()){
   try{
    try(var lock=c.prepareStatement("select pg_advisory_xact_lock(458217,2)")){lock.execute();}
    try(var p=c.prepareStatement("select id,actor_id,source_account,destination_account,amount from public.transactions where idempotency_key=?")){p.setObject(1,key);try(var r=p.executeQuery()){if(r.next()){if(!r.getObject(2,UUID.class).equals(actor)||!r.getObject(3,UUID.class).equals(source)||!r.getObject(4,UUID.class).equals(dest)||r.getBigDecimal(5).compareTo(amount)!=0)throw new IllegalArgumentException("Idempotency conflict");c.commit();return r.getObject(1,UUID.class);}}}
    String currency=null;try(var p=c.prepareStatement("select currency from public.accounts where id=? and owner_id=?")){p.setObject(1,source);p.setObject(2,actor);try(var r=p.executeQuery()){if(r.next())currency=r.getString(1);}}
    if(currency==null)throw new SecurityException("Source account denied");
    String prev=verifyChain(c);
    String canonical=key+"|"+actor+"|"+source+"|"+dest+"|"+amount.toPlainString()+"|"+currency+"|"+prev;
    String hash=audit.sha(canonical),signature=audit.sign(prev+hash);
    try(var set=c.prepareStatement("select set_config('app.actor_id',?,true)")){set.setString(1,actor.toString());set.execute();}
    UUID tx;try(var p=c.prepareStatement("select private.execute_double_entry_transfer(?,?,?,?,?,?,?,?)")){p.setObject(1,actor);p.setObject(2,source);p.setObject(3,dest);p.setBigDecimal(4,amount);p.setObject(5,key);p.setString(6,prev);p.setString(7,hash);p.setString(8,signature);try(var r=p.executeQuery()){r.next();tx=r.getObject(1,UUID.class);}}
    try(var p=c.prepareStatement("select coalesce(avg(amount),0) from public.transactions where actor_id=? and id<>?")){p.setObject(1,actor);p.setObject(2,tx);try(var r=p.executeQuery()){r.next();var avg=r.getBigDecimal(1);if(avg.signum()>0&&amount.compareTo(avg.multiply(BigDecimal.valueOf(3)))>0){try(var alert=c.prepareStatement("insert into public.fraud_alerts(actor_id,transaction_id,reason) values (?,?,'AMOUNT_ABOVE_3X_HISTORICAL_AVERAGE')")){alert.setObject(1,actor);alert.setObject(2,tx);alert.executeUpdate();}}}}
    c.commit();return tx;
   }catch(Exception ex){c.rollback();throw ex;}
  }
 }
 String verifyChain(Connection c)throws Exception{
  String prior=ZERO;
  try(var p=c.prepareStatement("select prev_hash,payload_hash,hmac_signature from public.audit_chain order by seq");var r=p.executeQuery()){
   while(r.next()){
    String prev=r.getString(1),payload=r.getString(2),sig=r.getString(3);
    if(!prior.equals(prev)||!audit.verify(prev+payload,sig))throw new SecurityException("Audit chain tampered");
    prior=audit.sha(prev+payload+sig);
   }
  }
  return prior;
 }
 void auditReport(HttpExchange e)throws IOException{
  try{if(preflight(e))return;UUID user=actor(e);try(var c=db.getConnection()){
   try(var p=c.prepareStatement("select role from public.profiles where id=?")){p.setObject(1,user);try(var r=p.executeQuery()){if(!r.next()||!"ADMIN".equals(r.getString(1)))throw new SecurityException("Admin only");}}
   String head=verifyChain(c);c.commit();respond(e,200,Map.of("valid",true,"head",head));
  }}catch(SecurityException x){respond(e,403,Map.of("error",x.getMessage()));}catch(Exception x){respond(e,503,Map.of("valid",false,"error","Audit unavailable or compromised"));}
 }
 void fx(HttpExchange e)throws IOException{
  try{if(preflight(e))return;actor(e);var query=Optional.ofNullable(e.getRequestURI().getQuery()).orElse("");var params=new HashMap<String,String>();for(var part:query.split("&")){var kv=part.split("=",2);if(kv.length==2)params.put(kv[0],kv[1]);}String from=params.getOrDefault("from","BRL").toUpperCase(Locale.ROOT),to=params.getOrDefault("to","USD").toUpperCase(Locale.ROOT);if(!Set.of("BRL","USD","EUR").contains(from)||!Set.of("BRL","USD","EUR").contains(to))throw new IllegalArgumentException("Unsupported currency");
   if(from.equals(to)){respond(e,200,Map.of("from",from,"to",to,"rate","1.0000"));return;}
   String pair=from+"-"+to;Quote q=quotes.get(pair);
   if(q==null||q.until<System.currentTimeMillis()){
    var req=HttpRequest.newBuilder(URI.create("https://api.frankfurter.app/latest?from="+from+"&to="+to)).timeout(Duration.ofSeconds(5)).GET().build();
    var response=http.send(req,HttpResponse.BodyHandlers.ofString());if(response.statusCode()!=200)throw new IOException("FX unavailable");
    q=new Quote(JSON.readTree(response.body()).path("rates").path(to).decimalValue().setScale(4,RoundingMode.HALF_EVEN).toPlainString(),System.currentTimeMillis()+300000);
    quotes.put(pair,q);
   }respond(e,200,Map.of("from",from,"to",to,"rate",q.rate,"source","Frankfurter"));
  }catch(IllegalArgumentException x){respond(e,400,Map.of("error",x.getMessage()));}catch(Exception x){respond(e,503,Map.of("error","FX unavailable"));}
 }
}
