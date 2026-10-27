import ts from "typescript";
import {readdirSync,readFileSync,mkdirSync,writeFileSync,existsSync} from "node:fs";
import {resolve,relative,dirname} from "node:path";
const root=resolve("src"),files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.name==="generated")continue;const path=resolve(dir,entry.name);if(entry.isDirectory())walk(path);else if(/\.(ts|tsx)$/.test(path))files.push(path);}}walk(root);
const imports=new Map(),clients=[];
function local(spec,from){const base=spec.startsWith("@/")?resolve(root,spec.slice(2)):spec.startsWith(".")?resolve(dirname(from),spec):null;if(!base)return null;return[base,base+".ts",base+".tsx",resolve(base,"index.ts"),resolve(base,"index.tsx")].find(p=>files.includes(p))??null;}
for(const file of files){const ast=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);if(ast.statements.some(s=>ts.isExpressionStatement(s)&&ts.isStringLiteral(s.expression)&&s.expression.text==="use client"))clients.push(file);const deps=[];
  for(const node of ast.statements){if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;if(!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier))continue;
    if(ts.isImportDeclaration(node)&&(node.importClause?.isTypeOnly||node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&!node.importClause.name&&node.importClause.namedBindings.elements.every(e=>e.isTypeOnly)))continue;
    if(ts.isExportDeclaration(node)&&node.isTypeOnly)continue;
    const spec=node.moduleSpecifier.text;deps.push({spec,target:local(spec,file)});
  }imports.set(file,deps);
}
const violations=[];
for(const entry of clients){const seen=new Set(),queue=[{file:entry,chain:[]}];while(queue.length){const {file,chain}=queue.shift();if(seen.has(file))continue;seen.add(file);for(const dep of imports.get(file)??[]){const next=[...chain,relative(root,file)];if(/^(node:|pg$|@prisma\/|web-push$|nodemailer$|graphile-worker$|next\/(headers|server)$)/.test(dep.spec)||dep.target?.startsWith(resolve(root,"server")+"\\")||dep.target?.startsWith(resolve(root,"server")+"/"))violations.push({client:relative(root,entry),import:dep.spec,chain:next});else if(dep.target)queue.push({file:dep.target,chain:next});}}}
const core=resolve(root,"modules/clinical/index.ts"),seen=new Set(),queue=[core];while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);for(const dep of imports.get(file)??[]){if(dep.target)queue.push(dep.target);else if(dep.spec!=="zod")violations.push({core:relative(root,file),import:dep.spec});}}
const report={at:new Date().toISOString(),scope:"Static imports and re-exports only; runtime permissions and dynamic imports need separate tests",sourceFiles:files.length,clientEntries:clients.length,calculationCoreFiles:seen.size,violations};
mkdirSync("docs/evidence",{recursive:true});writeFileSync("docs/evidence/architecture.json",JSON.stringify(report,null,2));console.info(JSON.stringify(report));if(violations.length)process.exitCode=1;
