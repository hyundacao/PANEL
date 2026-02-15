function isLikelyUnit(token){
 const normalized = token.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!normalized) return false;
 if(normalized==='kg'||normalized==='kgs'||normalized==='kq'||normalized==='k9'||normalized==='k6'||normalized==='ko') return true;
 if(normalized.startsWith('kg')) return true;
 if(normalized==='g') return true;
 if(normalized==='l'||normalized==='ltr'||normalized==='litr') return true;
 if(['szt','sztuk','sztuka','sztuki','sat','s2t','szl','pc','pcs'].includes(normalized)) return true;
 if(['opak','opakowanie','opakowania','opakowaniech','opakow'].includes(normalized)) return true;
 if(['m','mb','m2','m3'].includes(normalized)) return true;
 if(['kpl','op'].includes(normalized)) return true;
 return false;
}
function isLikelyIndex2Token(token, primaryIndex){
 const normalized=token.trim();
 if(!normalized||normalized==='-') return true;
 if(isLikelyUnit(normalized)) return false;
 if(/^\d{4,}$/.test(normalized)) return true;
 if(primaryIndex){
  const tokenNormalized = normalized.toUpperCase().replace(/[^A-Z0-9]/g,'');
  const primaryNormalized = primaryIndex.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(tokenNormalized && primaryNormalized){
    if(tokenNormalized===primaryNormalized) return true;
    if(tokenNormalized.includes(primaryNormalized)||primaryNormalized.includes(tokenNormalized)) return true;
  }
 }
 return /[-/]/.test(normalized) && /[A-Za-z]/.test(normalized);
}
function isLikelyDetachedIndex2Token(token, primaryIndex){
 const normalized=token.trim();
 if(!normalized||normalized==='-') return true;
 if(isLikelyUnit(normalized)) return false;
 if(isLikelyIndex2Token(token, primaryIndex)) return true;
 return /^\d{2,}$/.test(normalized);
}
function stripLeadingDetachedIndex2(tokens, primaryIndex){
 if(tokens.length<2) return {tokens};
 const first=tokens[0];
 if(!first) return {tokens};
 if(!isLikelyDetachedIndex2Token(first, primaryIndex)) return {tokens};
 return {tokens: tokens.slice(1), index2: first==='-'?undefined:first};
}
const cases=[
 ['fixed', ['003','KOLOR','DREWNI', '50,000'], '003'],
 ['nondet', ['55','KG','KONCENTRAT'], null],
 ['2d', ['21','50,000'], '21'],
 ['single', ['50'], null],
 ['name-start', ['21','Nazwa','PL'], '21']
];
for(const [label,tokens,expected] of cases){
 const res=stripLeadingDetachedIndex2(tokens,'M-1-BA');
 console.log(label, JSON.stringify(tokens),'->',res.index2,'rest',JSON.stringify(res.tokens));
}
