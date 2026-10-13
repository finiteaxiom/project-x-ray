"""Deterministic Python syntax and lexical-binding worker; never imports target code."""
import ast, base64, json, sys, hashlib

def tool_hash(path):
    with open(path, "rb") as stream:
        return hashlib.sha256(stream.read()).hexdigest()

def runtime_fingerprint():
    return hashlib.sha256(json.dumps([sys.version, sys.implementation.name, sys.implementation.cache_tag, tool_hash(sys.executable), tool_hash(ast.__file__)], separators=(",", ":")).encode()).hexdigest()

class Scope:
    def __init__(self, qualified="", parent=None, kind="module"):
        self.qualified, self.parent, self.kind = qualified, parent, kind
        self.bindings, self.globals, self.nonlocals = {}, set(), set()

class Analyzer(ast.NodeVisitor):
    def __init__(self, source):
        self.lines=source.splitlines(); self.symbols=[]; self.imports=[]; self.calls=[]; self.accesses=[]; self.returns=[]; self.endpoints=[]; self.seen=set(); self.root=Scope(); self.scope=self.root
    def col(self,line,bytecol):
        raw=self.lines[line-1].encode("utf-8")[:bytecol] if 0<line<=len(self.lines) else b""
        return len(raw.decode("utf-8","ignore").encode("utf-16-le"))//2
    def pos(self,node):
        end=getattr(node,"end_lineno",node.lineno)
        return {"line":node.lineno,"column":self.col(node.lineno,node.col_offset),"endLine":end,"endColumn":self.col(end,getattr(node,"end_col_offset",node.col_offset))}
    def qualify(self,name,scope=None):
        owner=(scope or self.scope).qualified
        return f"{owner}.{name}" if owner else name
    def symbol(self,node,kind,name,qualified=None,owner=None,binding_kind=None):
        qualified=qualified or self.qualify(name); key=(kind,qualified,node.lineno,node.col_offset)
        if key in self.seen:return
        self.seen.add(key); item={"kind":kind,"name":name,"qualified":qualified,**self.pos(node)}
        if owner:item["owner"]=owner
        if binding_kind:item["bindingKind"]=binding_kind
        self.symbols.append(item)
    @staticmethod
    def assigned(target):
        if isinstance(target,ast.Name):return [target.id]
        if isinstance(target,(ast.Tuple,ast.List)):return [name for child in target.elts for name in Analyzer.assigned(child)]
        return []
    @staticmethod
    def scope_statements(body):
        for statement in body:
            yield statement
            if isinstance(statement,(ast.If,ast.For,ast.AsyncFor,ast.While)):
                yield from Analyzer.scope_statements(statement.body)
                yield from Analyzer.scope_statements(statement.orelse)
            elif isinstance(statement,(ast.With,ast.AsyncWith)):
                yield from Analyzer.scope_statements(statement.body)
            elif isinstance(statement,(ast.Try,getattr(ast,"TryStar",ast.Try))):
                yield from Analyzer.scope_statements(statement.body)
                for handler in statement.handlers:
                    yield handler
                    yield from Analyzer.scope_statements(handler.body)
                yield from Analyzer.scope_statements(statement.orelse)
                yield from Analyzer.scope_statements(statement.finalbody)
            elif hasattr(ast,"Match") and isinstance(statement,ast.Match):
                for case in statement.cases:yield from Analyzer.scope_statements(case.body)
    def collect(self,body,scope):
        statements=list(self.scope_statements(body))
        for statement in statements:
            if isinstance(statement,ast.Global):scope.globals.update(statement.names)
            elif isinstance(statement,ast.Nonlocal):scope.nonlocals.update(statement.names)
        for statement in statements:
            if isinstance(statement,(ast.FunctionDef,ast.AsyncFunctionDef)):
                decorated=bool(statement.decorator_list); scope.bindings[statement.name]={"kind":"decorated-function" if decorated else "function","qualified":self.qualify(statement.name,scope)}
            elif isinstance(statement,ast.ClassDef):scope.bindings[statement.name]={"kind":"class","qualified":self.qualify(statement.name,scope)}
            elif isinstance(statement,ast.Import):
                for alias in statement.names:
                    local=alias.asname or alias.name.split(".")[0]; scope.bindings[local]={"kind":"import-module","module":alias.name,"local":local}
            elif isinstance(statement,ast.ImportFrom):
                module="."*statement.level+(statement.module or "")
                for alias in statement.names:
                    local=alias.asname or alias.name; scope.bindings[local]={"kind":"import-member","module":module,"member":alias.name,"local":local}
            elif isinstance(statement,(ast.Assign,ast.AnnAssign,ast.AugAssign,ast.For,ast.AsyncFor)):
                targets=statement.targets if isinstance(statement,ast.Assign) else [statement.target]
                for target in targets:
                    for name in self.assigned(target):
                        if name not in scope.globals and name not in scope.nonlocals:scope.bindings[name]={"kind":"variable","qualified":self.qualify(name,scope)}
            elif isinstance(statement,(ast.With,ast.AsyncWith)):
                for item in statement.items:
                    for name in self.assigned(item.optional_vars) if item.optional_vars else []:
                        if name not in scope.globals and name not in scope.nonlocals:scope.bindings[name]={"kind":"variable","qualified":self.qualify(name,scope)}
            elif isinstance(statement,ast.ExceptHandler) and statement.name:
                if statement.name not in scope.globals and statement.name not in scope.nonlocals:scope.bindings[statement.name]={"kind":"variable","qualified":self.qualify(statement.name,scope)}
    def resolve(self,name,scope=None):
        scope=scope or self.scope
        if name in scope.globals:return self.root.bindings.get(name)
        if name in scope.nonlocals:
            parent=scope.parent
            while parent and parent.parent:
                if name in parent.bindings:return parent.bindings[name]
                parent=parent.parent
            return None
        if name in scope.bindings:return scope.bindings[name]
        return self.resolve(name,scope.parent) if scope.parent else None
    def callable(self):
        scope=self.scope
        while scope:
            if scope.kind in ("function","method"):return scope.qualified
            scope=scope.parent
        return None
    @staticmethod
    def expression(node):
        if isinstance(node,ast.Name):return node.id
        if isinstance(node,ast.Attribute):
            parts=[]; cursor=node
            while isinstance(cursor,ast.Attribute):parts.append(cursor.attr); cursor=cursor.value
            if isinstance(cursor,ast.Name):parts.append(cursor.id); return ".".join(reversed(parts))
        return "<dynamic>"
    @staticmethod
    def literal(node):return node.value if isinstance(node,ast.Constant) and isinstance(node.value,str) else "<dynamic>"
    def resolution(self,node):
        if isinstance(node,ast.Name):
            binding=self.resolve(node.id)
            if not binding:return {"resolution":"unresolved","rootName":node.id}
            if binding["kind"] in ("function","class"):return {"resolution":"local","rootName":node.id,"targetQualified":binding["qualified"]}
            if binding["kind"]=="decorated-function":return {"resolution":"decorated","rootName":node.id}
            if binding["kind"].startswith("import-"):
                result={"resolution":"import","rootName":node.id,"importModule":binding["module"]}
                if binding.get("member"):result["importMember"]=binding["member"]
                return result
            return {"resolution":"shadowed","rootName":node.id}
        if isinstance(node,ast.Attribute):
            cursor=node; members=[]
            while isinstance(cursor,ast.Attribute):members.append(cursor.attr); cursor=cursor.value
            if isinstance(cursor,ast.Name):
                binding=self.resolve(cursor.id)
                if binding and binding["kind"]=="import-module":return {"resolution":"import","rootName":cursor.id,"importModule":binding["module"],"importMember":".".join(reversed(members))}
                return {"resolution":"attribute","rootName":cursor.id}
        return {"resolution":"dynamic"}
    def route(self,decorator):
        if not isinstance(decorator,ast.Call):return None
        name=self.expression(decorator.func); last=name.split(".")[-1].lower()
        if last in ("get","post","put","patch","delete","options","head","websocket"):return ("FastAPI-compatible",last.upper(),self.literal(decorator.args[0]) if decorator.args else "<dynamic>")
        if last=="route":
            method="ANY"
            for keyword in decorator.keywords:
                if keyword.arg=="methods" and isinstance(keyword.value,(ast.List,ast.Tuple)) and keyword.value.elts:method=self.literal(keyword.value.elts[0]).upper()
            return ("Flask",method,self.literal(decorator.args[0]) if decorator.args else "<dynamic>")
        return None
    def enter_function(self,node):
        qualified=self.qualify(node.name); kind="method" if self.scope.kind=="class" else "function"; binding_kind="decorated-definition" if node.decorator_list else "definition"; self.symbol(node,kind,node.name,qualified,self.scope.qualified or None,binding_kind)
        for decorator in node.decorator_list:
            route=self.route(decorator)
            if route:
                framework,method,path=route; self.endpoints.append({"framework":framework,"method":method,"route":path,"handler":qualified,**self.pos(decorator)})
        child=Scope(qualified,self.scope,kind); args=list(node.args.posonlyargs)+list(node.args.args)+list(node.args.kwonlyargs)
        if node.args.vararg:args.append(node.args.vararg)
        if node.args.kwarg:args.append(node.args.kwarg)
        for argument in args:
            child.bindings[argument.arg]={"kind":"parameter","qualified":f"{qualified}.{argument.arg}"}; self.symbol(argument,"variable",argument.arg,f"{qualified}.{argument.arg}",qualified,"parameter")
        self.collect(node.body,child); previous=self.scope; self.scope=child
        for statement in node.body:self.visit(statement)
        self.scope=previous
    def visit_FunctionDef(self,node):self.enter_function(node)
    def visit_AsyncFunctionDef(self,node):self.enter_function(node)
    def visit_ClassDef(self,node):
        qualified=self.qualify(node.name); self.symbol(node,"class",node.name,qualified,self.scope.qualified or None,"definition"); child=Scope(qualified,self.scope,"class"); self.collect(node.body,child); previous=self.scope; self.scope=child
        for statement in node.body:self.visit(statement)
        self.scope=previous
    def visit_Import(self,node):
        for alias in node.names:self.imports.append({"module":alias.name,"local":alias.asname or alias.name.split(".")[0],"alias":alias.asname,"scope":self.scope.qualified,**self.pos(node)})
    def visit_ImportFrom(self,node):
        module="."*node.level+(node.module or "")
        for alias in node.names:self.imports.append({"module":module,"member":alias.name,"local":alias.asname or alias.name,"alias":alias.asname,"scope":self.scope.qualified,**self.pos(node)})
    def visit_Name(self,node):
        caller=self.callable(); binding=self.resolve(node.id)
        if isinstance(node.ctx,ast.Store):
            qualified=binding.get("qualified") if binding else self.qualify(node.id); owner=qualified.rsplit(".",1)[0] if "." in qualified else None; self.symbol(node,"variable",node.id,qualified,owner,"assignment")
        if caller:self.accesses.append({"caller":caller,"target":node.id,"targetQualified":binding.get("qualified") if binding else None,"mode":"write" if isinstance(node.ctx,ast.Store) else "read",**self.pos(node)})
    def visit_Call(self,node):
        caller=self.callable()
        if caller:self.calls.append({"caller":caller,"expression":self.expression(node.func),**self.resolution(node.func),**self.pos(node)})
        expression=self.expression(node.func)
        if expression.split(".")[-1] in ("path","re_path") and len(node.args)>1:self.endpoints.append({"framework":"Django","method":"ANY","route":self.literal(node.args[0]),"handler":self.expression(node.args[1]),**self.pos(node)})
        self.generic_visit(node)
    def visit_Return(self,node):
        caller=self.callable()
        if caller and node.value:
            for child in ast.walk(node.value):
                if isinstance(child,ast.Name):
                    binding=self.resolve(child.id); self.returns.append({"caller":caller,"target":child.id,"targetQualified":binding.get("qualified") if binding else None,**self.pos(child)})
        self.generic_visit(node)

    def visit_comprehension(self,node,outputs):
        previous=self.scope
        generators=node.generators
        if not generators:return
        self.visit(generators[0].iter)
        child=Scope(f"{self.scope.qualified}::<comprehension:{node.lineno}:{node.col_offset}>",self.scope,"comprehension")
        self.scope=child
        for index,generator in enumerate(generators):
            if index:self.visit(generator.iter)
            for name in self.assigned(generator.target):child.bindings[name]={"kind":"variable","qualified":self.qualify(name,child)}
            self.visit(generator.target)
            for condition in generator.ifs:self.visit(condition)
        for output in outputs:self.visit(output)
        self.scope=previous
    def visit_ListComp(self,node):self.visit_comprehension(node,[node.elt])
    def visit_SetComp(self,node):self.visit_comprehension(node,[node.elt])
    def visit_GeneratorExp(self,node):self.visit_comprehension(node,[node.elt])
    def visit_DictComp(self,node):self.visit_comprehension(node,[node.key,node.value])

def main():
    payload=json.load(sys.stdin); source=base64.b64decode(payload["sourceBase64"]).decode("utf-8"); tree=ast.parse(source,filename=payload.get("filePath","<input>")); analyzer=Analyzer(source); analyzer.collect(tree.body,analyzer.root); analyzer.visit(tree)
    json.dump({"protocolVersion":"2.2.0","runtimeFingerprint":runtime_fingerprint(),"workerDigest":tool_hash(__file__),"symbols":analyzer.symbols,"imports":analyzer.imports,"calls":analyzer.calls,"accesses":analyzer.accesses,"returns":analyzer.returns,"endpoints":analyzer.endpoints},sys.stdout)
if __name__=="__main__":main()
