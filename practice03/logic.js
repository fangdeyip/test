/**
 * logic.js —— 布尔表达式解析与逻辑运算引擎
 *
 * 设计原则：朴素的递归下降 + `'` 作为可被 parser 显式接受的后缀运算符。
 * 表达式语法：
 *   expr        → xor_expr ((| | +) xor_expr)*
 *   xor_expr    → and_expr (^ and_expr)*
 *   and_expr    → and_term ((& | *) and_term)*
 *   and_term    → NOT* atom NOT*
 *   atom        → VAR | CONST | ( expr )
 *
 * 运算符：& * = AND，| + = OR，^ = XOR，! ~ ' = NOT（一元）
 * 优先级：NOT > AND > OR > XOR
 */

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[A-Za-z]/.test(ch)) { tokens.push({ type:"VAR", value:ch.toUpperCase() }); i++; continue; }
    if (ch==="0" || ch==="1") { tokens.push({ type:"CONST", value:parseInt(ch,10) }); i++; continue; }
    if ("&*|+^".indexOf(ch)>=0) { tokens.push({ type:"OP2", value:ch }); i++; continue; }
    if (ch==="(" || ch===")") { tokens.push({ type:"PAREN", value:ch }); i++; continue; }
    if ("!~'".indexOf(ch)>=0) { tokens.push({ type:"NOT", value:ch }); i++; continue; }
    throw new Error("无法识别字符 "+ch+"（位置 "+i+"）");
  }
  return tokens;
}

// 合并连续多个 NOT-NOT（两两抵消），并消除 'A'' 类的连续 NOT（不消除！）
// 我们不在 tokenize 阶段合并，因为 parser 会自然处理多 NOT 链
// 但 'A'' 应该被解释为 NOT A 再 NOT - 等价于 A -> 这由 parser 自动算

// —— 隐式 AND ——
function insertImplicitAND(s){
  // 在 "原子后紧跟 ' 后再紧跟 [VAR/CONST/(" 时插入 &
  // A'B   → A'&B   (NOT A AND B)
  // AB'   → AB'    (A AND NOT B，不插)
  // (A+B)'C → (A+B)'&C  (NOT(A+B) AND C)
  // A''B   → A''&B  (A double-NOT AND B)
  // 匹配模式: VAR/CONST/) 后跟 1+个 ' 再跟 VAR/CONST/(
  return s.replace(/([A-Za-z0-9)])(''*)(?=[A-Za-z0-9(])/g, "$1$2&");
}

class Parser {
  constructor(tokens){this.tokens=tokens;this.pos=0;}
  peek(){return this.tokens[this.pos];}
  consume(){return this.tokens[this.pos++];}
  parse(){
    const ast=this._expr();
    if(this.pos<this.tokens.length) throw new Error("表达式解析后剩余未处理 token");
    return ast;
  }
  _isOP(v){const t=this.peek();return !!t && t.type==="OP2" && t.value===v;}

  _expr(){ // OR
    let node=this._xor_expr();
    while(this._isOP("|")||this._isOP("+")){this.consume();node={op:"OR",left:node,right:this._xor_expr()};}
    return node;
  }
  _xor_expr(){ // XOR
    let node=this._and_expr();
    while(this._isOP("^")){this.consume();node={op:"XOR",left:node,right:this._and_expr()};}
    return node;
  }
  _and_expr(){ // AND
    let node=this._and_term();
    while(this._isOP("&")||this._isOP("*")){this.consume();node={op:"AND",left:node,right:this._and_term()};}
    return node;
  }
  _and_term(){ // NOT* atom NOT*
    let n=0;
    while(this.peek() && this.peek().type==="NOT"){this.consume();n++;}
    let node=this._atom();
    while(this.peek() && this.peek().type==="NOT"){this.consume();n++;}
    while(n-->0) node={op:"NOT", child:node};
    return node;
  }
  _atom(){
    const t=this.peek();
    if(!t) throw new Error("意外的表达式结尾");
    if(t.type==="VAR"){this.consume();return {op:"VAR",name:t.value};}
    if(t.type==="CONST"){this.consume();return {op:"CONST",value:t.value};}
    if(t.type==="PAREN" && t.value==="("){
      this.consume();
      const node=this._expr();
      const c=this.consume();
      if(!c || c.type!=="PAREN" || c.value!==")") throw new Error("括号不匹配，缺少右括号 )");
      return node;
    }
    throw new Error("语法错误：无法解析 token");
  }
}

function evalAST(ast,binding){
  switch(ast.op){
    case "VAR": return binding[ast.name]?1:0;
    case "CONST": return ast.value;
    case "NOT": return evalAST(ast.child,binding)^1;
    case "AND": return evalAST(ast.left,binding)&evalAST(ast.right,binding);
    case "OR": return evalAST(ast.left,binding)|evalAST(ast.right,binding);
    case "XOR": return evalAST(ast.left,binding)^evalAST(ast.right,binding);
    default: throw new Error("未知操作符 "+ast.op);
  }
}

function parse(expr){
  if(!expr||!expr.trim()) throw new Error("表达式不能为空");
  const ast=new Parser(tokenize(insertImplicitAND(expr.trim()))).parse();
  const varSet=new Set();
  function collect(n){if(!n)return;if(n.op==="VAR")varSet.add(n.name);if(n.left)collect(n.left);if(n.right)collect(n.right);if(n.child)collect(n.child);}
  collect(ast);
  const vars=Array.from(varSet).sort();
  if(vars.length<1) throw new Error("表达式至少需要 1 个变量");
  if(vars.length>4) throw new Error("目前仅支持 1~4 个变量（识别 "+vars.length+" 个）");
  return {ast,vars,n:vars.length};
}

function buildTruthTable(exprStr){
  const parsed=parse(exprStr);
  const {ast,vars,n}=parsed;
  const rows=[];
  for(let mask=0;mask<(1<<n);mask++){
    const binding={};
    for(let i=0;i<n;i++) binding[vars[i]]=(mask>>(n-1-i))&1;
    rows.push({mask,binding,out:evalAST(ast,binding)});
  }
  return {vars,rows};
}

function simplifyKM(exprStr){
  const {vars,rows}=buildTruthTable(exprStr);
  const n=vars.length;
  const ones=rows.filter(function(r){return r.out===1;}).map(function(r){return r.mask;});
  if(ones.length===0) return {vars,rows,primeImplicants:[],essential:[],kmapGroups:[],simplifiedExpr:"0"};
  if(ones.length===(1<<n)) return {vars,rows,primeImplicants:[],essential:[],kmapGroups:[],simplifiedExpr:"1"};

  const allPIs=findPrimeImplicants(n,ones,vars);
  if(allPIs.length===0) return {vars,rows,primeImplicants:[],essential:[],kmapGroups:[],simplifiedExpr:""};

  const coveredBy={};
  for(const m of ones) coveredBy[m]=[];
  for(const pi of allPIs) for(const m of pi.cover){if(!coveredBy[m])coveredBy[m]=[];coveredBy[m].push(pi);}
  const essential=allPIs.filter(function(pi){return pi.cover.some(function(m){return coveredBy[m]&&coveredBy[m].length===1;});});

  let uncovered=new Set(ones.filter(function(m){return !essential.some(function(pi){return pi.cover.indexOf(m)>=0;});}));
  const used=new Set(essential.map(function(pi){return pi.label;}));
  const extra=[];
  while(uncovered.size>0){
    let best=null,bestCount=0;
    for(const pi of allPIs){
      if(used.has(pi.label)) continue;
      let cnt=0;for(const m of pi.cover) if(uncovered.has(m)) cnt++;
      if(cnt>bestCount){bestCount=cnt;best=pi;}
    }
    if(!best) break;
    extra.push(best);used.add(best.label);
    for(const m of best.cover) uncovered.delete(m);
  }

  const primeImplicants=essential.concat(extra);
  const simplifiedExpr=primeImplicants.map(function(pi){return pi.label;}).join(" + ");
  return {vars,rows,primeImplicants,essential,kmapGroups:primeImplicants.map(function(pi,i){return Object.assign({},pi,{groupId:i});}),simplifiedExpr};
}

function findPrimeImplicants(n,ones,vars){
  function countOnes(m){let c=0;while(m){c++;m&=m-1;}return c;}
  let groups=Array.from({length:n+1},function(){return [];});
  for(const m of ones) groups[countOnes(m)].push({mask:m,cover:[m]});
  const primeImplicants=[];
  while(true){
    const nextGroups=Array.from({length:n+1},function(){return [];});
    const used=new Set();
    for(let g=0;g<n;g++) for(const a of groups[g]) for(const b of groups[g+1]){
      const diff=a.mask^b.mask;
      if(diff!==0 && (diff&(diff-1))===0){
        const combinedMask=a.mask&b.mask;
        const combinedCover=Array.from(new Set(a.cover.concat(b.cover)));
        nextGroups[g].push({mask:combinedMask,cover:combinedCover});
        used.add(a);used.add(b);
      }
    }
    for(let g=0;g<=n;g++) for(const t of groups[g]){
      if(!used.has(t)) primeImplicants.push({mask:t.mask,cover:t.cover,label:maskToLabel(t.mask,n,vars)});
    }
    if(nextGroups.every(function(g){return g.length===0;})) break;
    const mergedMap=new Map();
    for(const group of nextGroups) for(const item of group){
      const arr=mergedMap.get(item.mask)||new Set();
      for(const c of item.cover) arr.add(c);
      mergedMap.set(item.mask,arr);
    }
    groups=Array.from({length:n+1},function(){return [];});
    for(const [mask,coverSet] of mergedMap) groups[countOnes(mask)].push({mask,cover:Array.from(coverSet)});
  }
  return primeImplicants;
}

function maskToLabel(mask,n,vars){
  const parts=[];
  for(let i=0;i<n;i++){
    const bit=(mask>>(n-1-i))&1;
    parts.push(bit===1?vars[i]:vars[i]+"'");
  }
  return parts.join("·");
}

function normalizeExpr(expr){
  return expr
    .replace(/\s+/g,"")
    .replace(/!/g,"'")
    .replace(/~/g,"'")
    .replace(/''+/g, function(m){return (m.length%2===1)?"'":"";})
    .replace(/([&*])/g,"·");
}

window.LogicEngine={parse:parse,buildTruthTable:buildTruthTable,simplifyKM:simplifyKM,normalizeExpr:normalizeExpr,maskToLabel:maskToLabel};
