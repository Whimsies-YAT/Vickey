use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

#[cfg(feature = "console_error_panic_hook")]
extern "C" {
    fn console_log(msg: *const u8, len: usize);
}

const MAX_CALL_STACK_DEPTH: usize = 1000;
const MAX_EVALUATION_STEPS: usize = 100_000;
const MAX_OUTPUT_LENGTH: usize = 100_000;
const MAX_LIST_SIZE: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LispError {
    ParseError(String),
    RuntimeError(String),
    StackOverflow,
    ExecutionLimitExceeded,
    OutputLimitExceeded,
    DivisionByZero,
    TypeError(String),
    UndefinedSymbol(String),
    InvalidArity { expected: usize, actual: usize },
    ListTooLarge,
    InputRequired(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LispExecutionResult {
    pub output: String,
    pub result: Option<String>,
    pub environment: Vec<(String, String)>,
    pub steps_executed: usize,
    pub error: Option<LispError>,
    pub finished: bool,
    pub waiting_for_input: bool,
    pub input_prompt: Option<String>,
}

#[derive(Debug, Clone)]
pub enum LispValue {
    Nil,
    Number(f64),
    Symbol(String),
    String(String),
    Bool(bool),
    List(Vec<LispValue>),
    Lambda {
        params: Vec<String>,
        body: Box<LispValue>,
        closure: HashMap<String, LispValue>,
    },
    Builtin(String),
}

impl LispValue {
    fn is_truthy(&self) -> bool {
        match self {
            LispValue::Nil => false,
            LispValue::Bool(b) => *b,
            _ => true,
        }
    }
}

#[derive(Debug, Clone)]
struct Environment {
    vars: HashMap<String, LispValue>,
    parent: Option<Rc<Environment>>,
}

impl Environment {
    fn new() -> Self {
        Self {
            vars: HashMap::new(),
            parent: None,
        }
    }

    fn with_parent(parent: Rc<Environment>) -> Self {
        Self {
            vars: HashMap::new(),
            parent: Some(parent),
        }
    }

    fn get(&self, name: &str) -> Option<&LispValue> {
        self.vars.get(name).or_else(|| {
            self.parent.as_ref().and_then(|p| p.get(name))
        })
    }

    fn set(&mut self, name: String, value: LispValue) {
        self.vars.insert(name, value);
    }

    fn to_serializable(&self) -> Vec<(String, String)> {
        let mut result = Vec::new();
        for (k, v) in &self.vars {
            if !k.starts_with("builtin:") {
                result.push((k.clone(), format!("{:?}", v)));
            }
        }
        if let Some(parent) = &self.parent {
            result.extend(parent.to_serializable());
        }
        result
    }
}

#[wasm_bindgen]
pub struct LispInterpreter {
    env: Rc<Environment>,
    call_stack_depth: usize,
    evaluation_steps: usize,
    output: String,
    finished: bool,
    error: Option<LispError>,
    waiting_for_input: bool,
    input_prompt: Option<String>,
    input_buffer: VecDeque<String>,
    saved_code: Option<String>,
}

#[wasm_bindgen]
impl LispInterpreter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        let mut interpreter = Self {
            env: Rc::new(Environment::new()),
            call_stack_depth: 0,
            evaluation_steps: 0,
            output: String::new(),
            finished: false,
            error: None,
            waiting_for_input: false,
            input_prompt: None,
            input_buffer: VecDeque::new(),
            saved_code: None,
        };
        interpreter.setup_builtins();
        interpreter
    }

    #[wasm_bindgen]
    pub fn evaluate(&mut self, input: &str) -> JsValue {
        let is_continuing = self.waiting_for_input;

        if !self.waiting_for_input {
            if input.trim().is_empty() {
                return serde_wasm_bindgen::to_value(&LispExecutionResult {
                    output: self.output.clone(),
                    result: None,
                    environment: self.env.to_serializable(),
                    steps_executed: self.evaluation_steps,
                    error: Some(LispError::RuntimeError("No code to execute".to_string())),
                    finished: true,
                    waiting_for_input: false,
                    input_prompt: None,
                }).unwrap_or(JsValue::NULL);
            }
            self.call_stack_depth = 0;
            self.evaluation_steps = 0;
            self.output.clear();
            self.finished = false;
            self.error = None;
            self.saved_code = Some(input.to_string());
        }

        self.waiting_for_input = false;
        self.input_prompt = None;

        let code_to_eval = if let Some(ref saved) = self.saved_code {
            saved.clone()
        } else {
            input.to_string()
        };

        let result = match self.parse_and_eval(&code_to_eval) {
            Ok(value) => LispExecutionResult {
                output: self.output.clone(),
                result: Some(self.value_to_string(&value)),
                environment: self.env.to_serializable(),
                steps_executed: self.evaluation_steps,
                error: None,
                finished: true,
                waiting_for_input: self.waiting_for_input,
                input_prompt: self.input_prompt.clone(),
            },
            Err(LispError::InputRequired(_)) => {
                LispExecutionResult {
                    output: self.output.clone(),
                    result: None,
                    environment: self.env.to_serializable(),
                    steps_executed: self.evaluation_steps,
                    error: None,
                    finished: false,
                    waiting_for_input: self.waiting_for_input,
                    input_prompt: self.input_prompt.clone(),
                }
            },
            Err(e) => {
                self.error = Some(e.clone());
                LispExecutionResult {
                    output: self.output.clone(),
                    result: None,
                    environment: self.env.to_serializable(),
                    steps_executed: self.evaluation_steps,
                    error: Some(e),
                    finished: true,
                    waiting_for_input: self.waiting_for_input,
                    input_prompt: self.input_prompt.clone(),
                }
            }
        };

        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen]
    pub fn get_output(&self) -> String {
        self.output.clone()
    }

    #[wasm_bindgen]
    pub fn clear_output(&mut self) {
        self.output.clear();
    }

    #[wasm_bindgen]
    pub fn reset(&mut self) {
        let new_env = Environment::new();
        self.env = Rc::new(new_env);
        self.setup_builtins();
        self.call_stack_depth = 0;
        self.evaluation_steps = 0;
        self.output.clear();
        self.finished = false;
        self.error = None;
        self.waiting_for_input = false;
        self.input_prompt = None;
        self.input_buffer.clear();
        self.saved_code = None;
    }

    #[wasm_bindgen]
    pub fn get_result(&self) -> JsValue {
        let result = LispExecutionResult {
            output: self.output.clone(),
            result: None,
            environment: self.env.to_serializable(),
            steps_executed: self.evaluation_steps,
            error: self.error.clone(),
            finished: self.finished,
            waiting_for_input: self.waiting_for_input,
            input_prompt: self.input_prompt.clone(),
        };

        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen]
    pub fn validate_syntax(code: &str) -> JsValue {
        let mut errors = Vec::new();

        match Self::tokenize(code) {
            Ok(tokens) => {
                let mut pos = 0;
                match Self::parse_static(&tokens, &mut pos) {
                    Ok(_) => {
                        if pos < tokens.len() {
                            errors.push("Extra tokens after expression".to_string());
                        }
                    }
                    Err(e) => {
                        errors.push(format!("Parse error: {:?}", e));
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Tokenization error: {:?}", e));
            }
        }

        serde_wasm_bindgen::to_value(&errors).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen]
    pub fn add_input(&mut self, input: &str) {
        self.input_buffer.push_back(input.to_string());
        self.waiting_for_input = false;
        self.input_prompt = None;
    }

    #[wasm_bindgen]
    pub fn is_waiting_for_input(&self) -> bool {
        self.waiting_for_input
    }

    #[wasm_bindgen]
    pub fn continue_execution(&mut self) -> JsValue {
        if !self.waiting_for_input {
            return serde_wasm_bindgen::to_value(&LispExecutionResult {
                output: self.output.clone(),
                result: None,
                environment: self.env.to_serializable(),
                steps_executed: self.evaluation_steps,
                error: Some(LispError::RuntimeError("Not waiting for input".to_string())),
                finished: true,
                waiting_for_input: false,
                input_prompt: None,
            }).unwrap_or(JsValue::NULL);
        }

        self.waiting_for_input = false;
        self.input_prompt = None;

        let result = LispExecutionResult {
            output: self.output.clone(),
            result: None,
            environment: self.env.to_serializable(),
            steps_executed: self.evaluation_steps,
            error: None,
            finished: false,
            waiting_for_input: self.waiting_for_input,
            input_prompt: self.input_prompt.clone(),
        };

        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }
}

impl LispInterpreter {
    fn setup_builtins(&mut self) {
        let env = Rc::make_mut(&mut self.env);
        let builtins = vec![
            ("+", LispValue::Builtin("+".to_string())),
            ("-", LispValue::Builtin("-".to_string())),
            ("*", LispValue::Builtin("*".to_string())),
            ("/", LispValue::Builtin("/".to_string())),
            ("mod", LispValue::Builtin("mod".to_string())),
            ("=", LispValue::Builtin("=".to_string())),
            ("<", LispValue::Builtin("<".to_string())),
            (">", LispValue::Builtin(">".to_string())),
            ("<=", LispValue::Builtin("<=".to_string())),
            (">=", LispValue::Builtin(">=".to_string())),
            ("and", LispValue::Builtin("and".to_string())),
            ("or", LispValue::Builtin("or".to_string())),
            ("not", LispValue::Builtin("not".to_string())),
            ("list", LispValue::Builtin("list".to_string())),
            ("car", LispValue::Builtin("car".to_string())),
            ("cdr", LispValue::Builtin("cdr".to_string())),
            ("cons", LispValue::Builtin("cons".to_string())),
            ("append", LispValue::Builtin("append".to_string())),
            ("length", LispValue::Builtin("length".to_string())),
            ("nth", LispValue::Builtin("nth".to_string())),
            ("null?", LispValue::Builtin("null?".to_string())),
            ("number?", LispValue::Builtin("number?".to_string())),
            ("string?", LispValue::Builtin("string?".to_string())),
            ("list?", LispValue::Builtin("list?".to_string())),
            ("symbol?", LispValue::Builtin("symbol?".to_string())),
            ("print", LispValue::Builtin("print".to_string())),
            ("println", LispValue::Builtin("println".to_string())),
            ("str", LispValue::Builtin("str".to_string())),
            ("sqrt", LispValue::Builtin("sqrt".to_string())),
            ("pow", LispValue::Builtin("pow".to_string())),
            ("abs", LispValue::Builtin("abs".to_string())),
            ("min", LispValue::Builtin("min".to_string())),
            ("max", LispValue::Builtin("max".to_string())),
            ("floor", LispValue::Builtin("floor".to_string())),
            ("ceil", LispValue::Builtin("ceil".to_string())),
            ("round", LispValue::Builtin("round".to_string())),
            ("input", LispValue::Builtin("input".to_string())),
            ("read-line", LispValue::Builtin("read-line".to_string())),
            ("defined?", LispValue::Builtin("defined?".to_string())),
            ("true", LispValue::Bool(true)),
            ("false", LispValue::Bool(false)),
        ];

        for (name, value) in builtins {
            env.set(name.to_string(), value);
        }
    }

    fn parse_and_eval(&mut self, input: &str) -> Result<LispValue, LispError> {
        let tokens = Self::tokenize(input)?;
        let mut pos = 0;
        let expr = Self::parse_static(&tokens, &mut pos)?;
        self.eval(expr, &self.env.clone())
    }

    fn tokenize(input: &str) -> Result<Vec<String>, LispError> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        let mut in_string = false;
        let mut in_comment = false;
        let mut chars = input.chars().peekable();

        while let Some(ch) = chars.next() {
            if in_comment {
                if ch == '\n' {
                    in_comment = false;
                }
                continue;
            }

            match ch {
                ';' if !in_string => {
                    if !current.is_empty() {
                        tokens.push(current);
                        current = String::new();
                    }
                    in_comment = true;
                }
                '"' => {
                    if in_string {
                        current.push(ch);
                        tokens.push(current);
                        current = String::new();
                        in_string = false;
                    } else {
                        if !current.is_empty() {
                            tokens.push(current);
                            current = String::new();
                        }
                        current.push(ch);
                        in_string = true;
                    }
                }
                '(' | ')' => {
                    if in_string {
                        current.push(ch);
                    } else {
                        if !current.is_empty() {
                            tokens.push(current);
                            current = String::new();
                        }
                        tokens.push(ch.to_string());
                    }
                }
                '\'' => {
                    if in_string {
                        current.push(ch);
                    } else {
                        if !current.is_empty() {
                            tokens.push(current);
                            current = String::new();
                        }
                        tokens.push("'".to_string());
                    }
                }
                ch if ch.is_whitespace() => {
                    if in_string {
                        current.push(ch);
                    } else if !current.is_empty() {
                        tokens.push(current);
                        current = String::new();
                    }
                }
                '\\' if in_string => {
                    current.push(ch);
                    if let Some(&next_ch) = chars.peek() {
                        chars.next();
                        match next_ch {
                            'n' => current.push('\n'),
                            't' => current.push('\t'),
                            'r' => current.push('\r'),
                            '\\' => current.push('\\'),
                            '"' => current.push('"'),
                            _ => {
                                current.push('\\');
                                current.push(next_ch);
                            }
                        }
                    }
                }
                _ => {
                    current.push(ch);
                }
            }
        }

        if in_string {
            return Err(LispError::ParseError("Unterminated string literal".to_string()));
        }

        if !current.is_empty() {
            tokens.push(current);
        }

        Ok(tokens)
    }

    fn parse_static(tokens: &[String], pos: &mut usize) -> Result<LispValue, LispError> {
        if *pos >= tokens.len() {
            return Err(LispError::ParseError("Unexpected end of input".to_string()));
        }

        let token = &tokens[*pos];
        *pos += 1;

        match token.as_str() {
            "(" => {
                let mut list = Vec::new();
                while *pos < tokens.len() && tokens[*pos] != ")" {
                    if list.len() >= MAX_LIST_SIZE {
                        return Err(LispError::ListTooLarge);
                    }
                    list.push(Self::parse_static(tokens, pos)?);
                }
                if *pos >= tokens.len() {
                    return Err(LispError::ParseError("Missing closing parenthesis".to_string()));
                }
                *pos += 1; // skip ')'
                Ok(LispValue::List(list))
            }
            ")" => Err(LispError::ParseError("Unexpected closing parenthesis".to_string())),
            "'" => {
                let quoted = Self::parse_static(tokens, pos)?;
                Ok(LispValue::List(vec![
                    LispValue::Symbol("quote".to_string()),
                    quoted
                ]))
            }
            token if token.starts_with('"') && token.ends_with('"') => {
                let content = &token[1..token.len()-1];
                Ok(LispValue::String(content.to_string()))
            }
            token => {
                if let Ok(num) = token.parse::<f64>() {
                    Ok(LispValue::Number(num))
                } else if token == "nil" {
                    Ok(LispValue::Nil)
                } else if token == "true" {
                    Ok(LispValue::Bool(true))
                } else if token == "false" {
                    Ok(LispValue::Bool(false))
                } else {
                    Ok(LispValue::Symbol(token.to_string()))
                }
            }
        }
    }

    fn eval(&mut self, expr: LispValue, env: &Rc<Environment>) -> Result<LispValue, LispError> {
        self.evaluation_steps += 1;
        if self.evaluation_steps > MAX_EVALUATION_STEPS {
            return Err(LispError::ExecutionLimitExceeded);
        }

        match expr {
            LispValue::Number(_) | LispValue::String(_) | LispValue::Nil | LispValue::Bool(_) => Ok(expr),
            LispValue::Symbol(ref name) => {
                env.get(name)
                    .cloned()
                    .ok_or_else(|| LispError::UndefinedSymbol(name.clone()))
            }
            LispValue::List(ref list) if list.is_empty() => Ok(LispValue::Nil),
            LispValue::List(ref list) => {
                let first = &list[0];

                if let LispValue::Symbol(ref name) = first {
                    match name.as_str() {
                        "quote" => {
                            if list.len() != 2 {
                                return Err(LispError::InvalidArity { expected: 1, actual: list.len() - 1 });
                            }
                            Ok(list[1].clone())
                        }
                        "if" => {
                            if list.len() < 3 || list.len() > 4 {
                                return Err(LispError::InvalidArity { expected: 3, actual: list.len() - 1 });
                            }
                            let condition = self.eval(list[1].clone(), env)?;
                            if condition.is_truthy() {
                                self.eval(list[2].clone(), env)
                            } else if list.len() == 4 {
                                self.eval(list[3].clone(), env)
                            } else {
                                Ok(LispValue::Nil)
                            }
                        }
                        "cond" => {
                            for clause in &list[1..] {
                                if let LispValue::List(clause_list) = clause {
                                    if clause_list.len() >= 2 {
                                        let condition = self.eval(clause_list[0].clone(), env)?;
                                        if condition.is_truthy() {
                                            return self.eval(clause_list[1].clone(), env);
                                        }
                                    }
                                }
                            }
                            Ok(LispValue::Nil)
                        }
                        "define" => {
                            if list.len() != 3 {
                                return Err(LispError::InvalidArity { expected: 2, actual: list.len() - 1 });
                            }
                            if let LispValue::Symbol(name) = &list[1] {
                                let value = self.eval(list[2].clone(), env)?;
                                let global_env = Rc::make_mut(&mut self.env);
                                global_env.set(name.clone(), value.clone());
                                Ok(value)
                            } else {
                                Err(LispError::TypeError("Expected symbol in define".to_string()))
                            }
                        }
                        "let" => {
                            if list.len() != 3 {
                                return Err(LispError::InvalidArity { expected: 2, actual: list.len() - 1 });
                            }
                            let mut new_env = Environment::with_parent(env.clone());

                            if let LispValue::List(bindings) = &list[1] {
                                for binding in bindings {
                                    if let LispValue::List(binding_pair) = binding {
                                        if binding_pair.len() == 2 {
                                            if let LispValue::Symbol(var_name) = &binding_pair[0] {
                                                let value = self.eval(binding_pair[1].clone(), env)?;
                                                new_env.set(var_name.clone(), value);
                                            } else {
                                                return Err(LispError::TypeError("Let binding name must be a symbol".to_string()));
                                            }
                                        } else {
                                            return Err(LispError::TypeError("Let binding must have exactly 2 elements".to_string()));
                                        }
                                    } else {
                                        return Err(LispError::TypeError("Let binding must be a list".to_string()));
                                    }
                                }
                            } else {
                                return Err(LispError::TypeError("Let bindings must be a list".to_string()));
                            }

                            self.eval(list[2].clone(), &Rc::new(new_env))
                        }
                        "lambda" | "fn" => {
                            if list.len() != 3 {
                                return Err(LispError::InvalidArity { expected: 2, actual: list.len() - 1 });
                            }
                            let params = match &list[1] {
                                LispValue::List(params) => {
                                    let mut param_names = Vec::new();
                                    for param in params {
                                        if let LispValue::Symbol(name) = param {
                                            param_names.push(name.clone());
                                        } else {
                                            return Err(LispError::TypeError("Lambda parameters must be symbols".to_string()));
                                        }
                                    }
                                    param_names
                                }
                                _ => return Err(LispError::TypeError("Lambda parameters must be a list".to_string())),
                            };
                            Ok(LispValue::Lambda {
                                params,
                                body: Box::new(list[2].clone()),
                                closure: env.vars.clone(),
                            })
                        }
                        "do" => {
                            let mut result = LispValue::Nil;
                            for expr in &list[1..] {
                                result = self.eval(expr.clone(), env)?;
                            }
                            Ok(result)
                        }
                        "begin" => {
                            let mut result = LispValue::Nil;
                            for expr in &list[1..] {
                                result = self.eval(expr.clone(), env)?;
                            }
                            Ok(result)
                        }
                        _ => {
                            let func = self.eval(first.clone(), env)?;
                            let mut args = Vec::new();
                            for arg in &list[1..] {
                                args.push(self.eval(arg.clone(), env)?);
                            }
                            self.apply_function(func, args)
                        }
                    }
                } else {
                    let func = self.eval(first.clone(), env)?;
                    let mut args = Vec::new();
                    for arg in &list[1..] {
                        args.push(self.eval(arg.clone(), env)?);
                    }
                    self.apply_function(func, args)
                }
            }
            LispValue::Lambda { .. } | LispValue::Builtin(_) => Ok(expr),
        }
    }

    fn apply_function(&mut self, func: LispValue, args: Vec<LispValue>) -> Result<LispValue, LispError> {
        self.call_stack_depth += 1;
        if self.call_stack_depth > MAX_CALL_STACK_DEPTH {
            return Err(LispError::StackOverflow);
        }

        let result = match func {
            LispValue::Builtin(ref name) => {
                self.apply_builtin(name, args)
            }
            LispValue::Lambda { params, body, closure } => {
                if params.len() != args.len() {
                    return Err(LispError::InvalidArity {
                        expected: params.len(),
                        actual: args.len()
                    });
                }

                let mut new_env = Environment::with_parent(self.env.clone());
                new_env.vars.extend(closure);

                for (param, arg) in params.iter().zip(args.iter()) {
                    new_env.set(param.clone(), arg.clone());
                }

                self.eval(*body, &Rc::new(new_env))
            }
            _ => Err(LispError::TypeError("Not a function".to_string())),
        };

        self.call_stack_depth -= 1;
        result
    }

    fn apply_builtin(&mut self, name: &str, args: Vec<LispValue>) -> Result<LispValue, LispError> {
        match name {
            "+" => {
                let mut sum = 0.0;
                for arg in args {
                    if let LispValue::Number(n) = arg {
                        sum += n;
                    } else {
                        return Err(LispError::TypeError("+ requires numbers".to_string()));
                    }
                }
                Ok(LispValue::Number(sum))
            }
            "-" => {
                if args.is_empty() {
                    return Err(LispError::InvalidArity { expected: 1, actual: 0 });
                }
                if let LispValue::Number(first) = &args[0] {
                    let mut result = *first;
                    if args.len() == 1 {
                        result = -result;
                    } else {
                        for arg in &args[1..] {
                            if let LispValue::Number(n) = arg {
                                result -= n;
                            } else {
                                return Err(LispError::TypeError("- requires numbers".to_string()));
                            }
                        }
                    }
                    Ok(LispValue::Number(result))
                } else {
                    Err(LispError::TypeError("- requires numbers".to_string()))
                }
            }
            "*" => {
                let mut product = 1.0;
                for arg in args {
                    if let LispValue::Number(n) = arg {
                        product *= n;
                    } else {
                        return Err(LispError::TypeError("* requires numbers".to_string()));
                    }
                }
                Ok(LispValue::Number(product))
            }
            "/" => {
                if args.is_empty() {
                    return Err(LispError::InvalidArity { expected: 1, actual: 0 });
                }
                if let LispValue::Number(first) = &args[0] {
                    let mut result = *first;
                    if args.len() == 1 {
                        if result == 0.0 {
                            return Err(LispError::DivisionByZero);
                        }
                        result = 1.0 / result;
                    } else {
                        for arg in &args[1..] {
                            if let LispValue::Number(n) = arg {
                                if *n == 0.0 {
                                    return Err(LispError::DivisionByZero);
                                }
                                result /= n;
                            } else {
                                return Err(LispError::TypeError("/ requires numbers".to_string()));
                            }
                        }
                    }
                    Ok(LispValue::Number(result))
                } else {
                    Err(LispError::TypeError("/ requires numbers".to_string()))
                }
            }
            "mod" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => {
                        if *b == 0.0 {
                            return Err(LispError::DivisionByZero);
                        }
                        Ok(LispValue::Number(a % b))
                    }
                    _ => Err(LispError::TypeError("mod requires numbers".to_string())),
                }
            }
            "=" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                let result = match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => (a - b).abs() < f64::EPSILON,
                    (LispValue::String(a), LispValue::String(b)) => a == b,
                    (LispValue::Bool(a), LispValue::Bool(b)) => a == b,
                    (LispValue::Nil, LispValue::Nil) => true,
                    _ => false,
                };
                Ok(LispValue::Bool(result))
            }
            "<" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => Ok(LispValue::Bool(a < b)),
                    _ => Err(LispError::TypeError("< requires numbers".to_string())),
                }
            }
            ">" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => Ok(LispValue::Bool(a > b)),
                    _ => Err(LispError::TypeError("> requires numbers".to_string())),
                }
            }
            "<=" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => Ok(LispValue::Bool(a <= b)),
                    _ => Err(LispError::TypeError("<= requires numbers".to_string())),
                }
            }
            ">=" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(a), LispValue::Number(b)) => Ok(LispValue::Bool(a >= b)),
                    _ => Err(LispError::TypeError(">= requires numbers".to_string())),
                }
            }
            "and" => {
                for arg in &args {
                    if !arg.is_truthy() {
                        return Ok(LispValue::Bool(false));
                    }
                }
                Ok(LispValue::Bool(true))
            }
            "or" => {
                for arg in &args {
                    if arg.is_truthy() {
                        return Ok(LispValue::Bool(true));
                    }
                }
                Ok(LispValue::Bool(false))
            }
            "not" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(!args[0].is_truthy()))
            }
            "list" => {
                if args.len() > MAX_LIST_SIZE {
                    return Err(LispError::ListTooLarge);
                }
                Ok(LispValue::List(args))
            }
            "car" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::List(list) if !list.is_empty() => Ok(list[0].clone()),
                    LispValue::List(_) => Ok(LispValue::Nil),
                    LispValue::Nil => Ok(LispValue::Nil),
                    _ => Err(LispError::TypeError("car requires a list".to_string())),
                }
            }
            "cdr" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::List(list) if !list.is_empty() => {
                        Ok(LispValue::List(list[1..].to_vec()))
                    }
                    LispValue::List(_) => Ok(LispValue::Nil),
                    LispValue::Nil => Ok(LispValue::Nil),
                    _ => Err(LispError::TypeError("cdr requires a list".to_string())),
                }
            }
            "cons" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match &args[1] {
                    LispValue::List(list) => {
                        let mut new_list = vec![args[0].clone()];
                        new_list.extend_from_slice(list);
                        if new_list.len() > MAX_LIST_SIZE {
                            return Err(LispError::ListTooLarge);
                        }
                        Ok(LispValue::List(new_list))
                    }
                    LispValue::Nil => Ok(LispValue::List(vec![args[0].clone()])),
                    _ => Err(LispError::TypeError("cons requires a list as second argument".to_string())),
                }
            }
            "append" => {
                let mut result = Vec::new();
                for arg in args {
                    match arg {
                        LispValue::List(list) => {
                            result.extend(list);
                            if result.len() > MAX_LIST_SIZE {
                                return Err(LispError::ListTooLarge);
                            }
                        }
                        LispValue::Nil => {},
                        _ => return Err(LispError::TypeError("append requires lists".to_string())),
                    }
                }
                Ok(LispValue::List(result))
            }
            "length" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::List(list) => Ok(LispValue::Number(list.len() as f64)),
                    LispValue::String(s) => Ok(LispValue::Number(s.len() as f64)),
                    LispValue::Nil => Ok(LispValue::Number(0.0)),
                    _ => Err(LispError::TypeError("length requires a list or string".to_string())),
                }
            }
            "nth" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(n), LispValue::List(list)) => {
                        let index = *n as usize;
                        if index < list.len() {
                            Ok(list[index].clone())
                        } else {
                            Ok(LispValue::Nil)
                        }
                    }
                    _ => Err(LispError::TypeError("nth requires a number and list".to_string())),
                }
            }
            "null?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(matches!(args[0], LispValue::Nil)))
            }
            "number?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(matches!(args[0], LispValue::Number(_))))
            }
            "string?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(matches!(args[0], LispValue::String(_))))
            }
            "list?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(matches!(args[0], LispValue::List(_))))
            }
            "symbol?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                Ok(LispValue::Bool(matches!(args[0], LispValue::Symbol(_))))
            }
            "print" => {
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        if self.output.len() + 1 > MAX_OUTPUT_LENGTH {
                            return Err(LispError::OutputLimitExceeded);
                        }
                        self.output.push(' ');
                    }
                    let arg_str = self.value_to_display_string(arg);
                    if self.output.len() + arg_str.len() > MAX_OUTPUT_LENGTH {
                        return Err(LispError::OutputLimitExceeded);
                    }
                    self.output.push_str(&arg_str);
                }
                Ok(LispValue::Nil)
            }
            "println" => {
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        if self.output.len() + 1 > MAX_OUTPUT_LENGTH {
                            return Err(LispError::OutputLimitExceeded);
                        }
                        self.output.push(' ');
                    }
                    let arg_str = self.value_to_display_string(arg);
                    if self.output.len() + arg_str.len() > MAX_OUTPUT_LENGTH {
                        return Err(LispError::OutputLimitExceeded);
                    }
                    self.output.push_str(&arg_str);
                }
                if self.output.len() + 1 > MAX_OUTPUT_LENGTH {
                    return Err(LispError::OutputLimitExceeded);
                }
                self.output.push('\n');
                Ok(LispValue::Nil)
            }
            "str" => {
                let mut result = String::new();
                for arg in args {
                    result.push_str(&self.value_to_display_string(&arg));
                }
                Ok(LispValue::String(result))
            }
            "sqrt" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Number(n) => {
                        if *n < 0.0 {
                            Ok(LispValue::Number(f64::NAN))
                        } else {
                            Ok(LispValue::Number(n.sqrt()))
                        }
                    }
                    _ => Err(LispError::TypeError("sqrt requires a number".to_string())),
                }
            }
            "pow" => {
                if args.len() != 2 {
                    return Err(LispError::InvalidArity { expected: 2, actual: args.len() });
                }
                match (&args[0], &args[1]) {
                    (LispValue::Number(base), LispValue::Number(exp)) => {
                        Ok(LispValue::Number(base.powf(*exp)))
                    }
                    _ => Err(LispError::TypeError("pow requires numbers".to_string())),
                }
            }
            "abs" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Number(n) => Ok(LispValue::Number(n.abs())),
                    _ => Err(LispError::TypeError("abs requires a number".to_string())),
                }
            }
            "min" => {
                if args.is_empty() {
                    return Err(LispError::InvalidArity { expected: 1, actual: 0 });
                }
                let mut min = match &args[0] {
                    LispValue::Number(n) => *n,
                    _ => return Err(LispError::TypeError("min requires numbers".to_string())),
                };
                for arg in &args[1..] {
                    if let LispValue::Number(n) = arg {
                        if *n < min {
                            min = *n;
                        }
                    } else {
                        return Err(LispError::TypeError("min requires numbers".to_string()));
                    }
                }
                Ok(LispValue::Number(min))
            }
            "max" => {
                if args.is_empty() {
                    return Err(LispError::InvalidArity { expected: 1, actual: 0 });
                }
                let mut max = match &args[0] {
                    LispValue::Number(n) => *n,
                    _ => return Err(LispError::TypeError("max requires numbers".to_string())),
                };
                for arg in &args[1..] {
                    if let LispValue::Number(n) = arg {
                        if *n > max {
                            max = *n;
                        }
                    } else {
                        return Err(LispError::TypeError("max requires numbers".to_string()));
                    }
                }
                Ok(LispValue::Number(max))
            }
            "floor" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Number(n) => Ok(LispValue::Number(n.floor())),
                    _ => Err(LispError::TypeError("floor requires a number".to_string())),
                }
            }
            "ceil" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Number(n) => Ok(LispValue::Number(n.ceil())),
                    _ => Err(LispError::TypeError("ceil requires a number".to_string())),
                }
            }
            "round" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Number(n) => Ok(LispValue::Number(n.round())),
                    _ => Err(LispError::TypeError("round requires a number".to_string())),
                }
            }
            "input" => {
                let prompt = if args.len() == 1 {
                    match &args[0] {
                        LispValue::String(s) => s.clone(),
                        _ => return Err(LispError::TypeError("input prompt must be a string".to_string())),
                    }
                } else if args.len() == 0 {
                    "Input: ".to_string()
                } else {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                };

                if let Some(input_line) = self.input_buffer.pop_front() {
                    Ok(LispValue::String(input_line))
                } else {
                    self.waiting_for_input = true;
                    self.input_prompt = Some(prompt.clone());
                    self.finished = false;
                    Err(LispError::InputRequired(prompt))
                }
            }
            "read-line" => {
                let prompt = if args.len() == 1 {
                    match &args[0] {
                        LispValue::String(s) => s.clone(),
                        _ => return Err(LispError::TypeError("read-line prompt must be a string".to_string())),
                    }
                } else if args.len() == 0 {
                    "> ".to_string()
                } else {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                };

                if let Some(input_line) = self.input_buffer.pop_front() {
                    Ok(LispValue::String(input_line))
                } else {
                    self.waiting_for_input = true;
                    self.input_prompt = Some(prompt.clone());
                    self.finished = false;
                    Err(LispError::InputRequired(prompt))
                }
            }
            "defined?" => {
                if args.len() != 1 {
                    return Err(LispError::InvalidArity { expected: 1, actual: args.len() });
                }
                match &args[0] {
                    LispValue::Symbol(name) => {
                        Ok(LispValue::Bool(self.env.get(name).is_some()))
                    }
                    _ => Err(LispError::TypeError("defined? requires a symbol".to_string())),
                }
            }
            _ => Err(LispError::RuntimeError(format!("Unknown builtin: {}", name))),
        }
    }

    fn value_to_string(&self, value: &LispValue) -> String {
        match value {
            LispValue::Nil => "nil".to_string(),
            LispValue::Number(n) => {
                if n.fract() == 0.0 && n.is_finite() {
                    format!("{:.0}", n)
                } else {
                    format!("{}", n)
                }
            }
            LispValue::Symbol(s) => s.clone(),
            LispValue::String(s) => format!("\"{}\"", s),
            LispValue::Bool(b) => b.to_string(),
            LispValue::List(list) => {
                let elements: Vec<String> = list.iter()
                    .map(|v| self.value_to_string(v))
                    .collect();
                format!("({})", elements.join(" "))
            }
            LispValue::Lambda { .. } => "<lambda>".to_string(),
            LispValue::Builtin(name) => format!("<builtin:{}>", name),
        }
    }

    fn value_to_display_string(&self, value: &LispValue) -> String {
        match value {
            LispValue::String(s) => s.clone(),
            _ => self.value_to_string(value),
        }
    }
}

#[wasm_bindgen]
pub fn get_example_programs() -> JsValue {
    let examples = vec![
        ("Hello World", "(println \"Hello, World!\")"),
        ("Basic arithmetic", "(+ 2 3 4)"),
        ("Fibonacci function", "(define fib (fn (n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2))))))\n(fib 10)"),
        ("Factorial", "(define fact (fn (n) (if (<= n 1) 1 (* n (fact (- n 1))))))\n(fact 5)"),
        ("List operations", "(define lst (list 1 2 3 4 5))\n(println \"First:\" (car lst))\n(println \"Rest:\" (cdr lst))\n(println \"Length:\" (length lst))"),
        ("Local variables", "(let ((x 10) (y 20)) (+ x y))"),
        ("Conditional logic", "(cond ((< 5 3) \"impossible\") ((> 10 8) \"correct\") (true \"fallback\"))"),
        ("Map function simulation", "(define map (fn (f lst) (if (null? lst) nil (cons (f (car lst)) (map f (cdr lst))))))\n(define square (fn (x) (* x x)))\n(map square (list 1 2 3 4))"),
        ("Simple calculator", "(define calc (fn (op a b) (cond ((= op '+) (+ a b)) ((= op '-) (- a b)) ((= op '*) (* a b)) ((= op '/) (/ a b)) (true \"Unknown operation\"))))\n(calc '+ 10 5)"),
        ("Type checking", "(define describe (fn (x) (cond ((number? x) \"It's a number\") ((string? x) \"It's a string\") ((list? x) \"It's a list\") ((null? x) \"It's nil\") (true \"Unknown type\"))))\n(describe 42)"),
    ];

    serde_wasm_bindgen::to_value(&examples).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen(start)]
pub fn main() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}