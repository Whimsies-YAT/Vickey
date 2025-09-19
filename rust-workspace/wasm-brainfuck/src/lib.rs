use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[cfg(feature = "console_error_panic_hook")]
extern "C" {
    fn console_log(msg: *const u8, len: usize);
}

const MAX_MEMORY_SIZE: usize = 65536;
const MEMORY_OFFSET: usize = 32768;
const MAX_LOOP_DEPTH: usize = 1000;
const MAX_EXECUTION_STEPS: usize = 100_000_000;
const MAX_OUTPUT_SIZE: usize = 100000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BrainfuckError {
    MemoryOverflow,
    MemoryUnderflow,
    UnmatchedOpenBracket,
    UnmatchedCloseBracket,
    LoopDepthExceeded,
    ExecutionLimitExceeded,
    OutputLimitExceeded,
    InputExhausted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub output: String,
    pub memory: Vec<u8>,
    pub pointer: usize,
    pub instruction_pointer: usize,
    pub steps_executed: usize,
    pub error: Option<BrainfuckError>,
    pub finished: bool,
    pub waiting_for_input: bool,
}

#[wasm_bindgen]
pub struct BrainfuckInterpreter {
    memory: Vec<u8>,
    pointer: usize,
    instruction_pointer: usize,
    program: Vec<u8>,
    input: VecDeque<u8>,
    output: String,
    loop_stack: Vec<usize>,
    steps_executed: usize,
    finished: bool,
    error: Option<BrainfuckError>,
}

#[wasm_bindgen]
impl BrainfuckInterpreter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self {
            memory: vec![0; MAX_MEMORY_SIZE],
            pointer: MEMORY_OFFSET,
            instruction_pointer: 0,
            program: Vec::new(),
            input: VecDeque::new(),
            output: String::new(),
            loop_stack: Vec::new(),
            steps_executed: 0,
            finished: false,
            error: None,
        }
    }

    #[wasm_bindgen]
    pub fn load_program(&mut self, program: &str) {
        self.program = program.bytes().collect();
        self.reset();
    }

    #[wasm_bindgen]
    pub fn set_input(&mut self, input: &str) {
        self.input = input.bytes().collect();
    }

    #[wasm_bindgen]
    pub fn add_input(&mut self, input: &str) {
        for byte in input.bytes() {
            self.input.push_back(byte);
        }
    }

    #[wasm_bindgen]
    pub fn is_waiting_for_input(&self) -> bool {
        if self.finished || self.error.is_some() {
            return false;
        }

        if self.instruction_pointer >= self.program.len() {
            return false;
        }

        let instruction = self.program[self.instruction_pointer];
        instruction == b',' && self.input.is_empty()
    }

    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.memory = vec![0; MAX_MEMORY_SIZE];
        self.pointer = MEMORY_OFFSET;
        self.instruction_pointer = 0;
        self.output.clear();
        self.loop_stack.clear();
        self.steps_executed = 0;
        self.finished = false;
        self.error = None;
    }

    #[wasm_bindgen]
    pub fn step(&mut self) -> bool {
        if self.finished || self.error.is_some() {
            return false;
        }

        if self.steps_executed >= MAX_EXECUTION_STEPS {
            self.error = Some(BrainfuckError::ExecutionLimitExceeded);
            self.finished = true;
            return false;
        }

        if self.instruction_pointer >= self.program.len() {
            self.finished = true;
            return false;
        }

        let instruction = self.program[self.instruction_pointer];
        self.steps_executed += 1;

        match instruction {
            b'>' => {
                if self.pointer >= MAX_MEMORY_SIZE - 1 {
                    self.error = Some(BrainfuckError::MemoryOverflow);
                    self.finished = true;
                    return false;
                }
                self.pointer += 1;
            }
            b'<' => {
                if self.pointer == 0 {
                    self.error = Some(BrainfuckError::MemoryUnderflow);
                    self.finished = true;
                    return false;
                }
                self.pointer -= 1;
            }
            b'+' => {
                self.memory[self.pointer] = self.memory[self.pointer].wrapping_add(1);
            }
            b'-' => {
                self.memory[self.pointer] = self.memory[self.pointer].wrapping_sub(1);
            }
            b'.' => {
                if self.output.len() >= MAX_OUTPUT_SIZE {
                    self.error = Some(BrainfuckError::OutputLimitExceeded);
                    self.finished = true;
                    return false;
                }
                self.output.push(self.memory[self.pointer] as char);
            }
            b',' => {
                if let Some(input_byte) = self.input.pop_front() {
                    self.memory[self.pointer] = input_byte;
                } else {
                    self.steps_executed -= 1;
                    return false;
                }
            }
            b'[' => {
                if self.memory[self.pointer] == 0 {
                    let mut depth = 1;
                    let mut ip = self.instruction_pointer + 1;
                    while ip < self.program.len() && depth > 0 {
                        match self.program[ip] {
                            b'[' => depth += 1,
                            b']' => depth -= 1,
                            _ => {}
                        }
                        ip += 1;
                    }
                    if depth > 0 {
                        self.error = Some(BrainfuckError::UnmatchedOpenBracket);
                        self.finished = true;
                        return false;
                    }
                    self.instruction_pointer = ip - 1;
                } else {
                    if self.loop_stack.len() >= MAX_LOOP_DEPTH {
                        self.error = Some(BrainfuckError::LoopDepthExceeded);
                        self.finished = true;
                        return false;
                    }
                    self.loop_stack.push(self.instruction_pointer);
                }
            }
            b']' => {
                if let Some(loop_start) = self.loop_stack.pop() {
                    if self.memory[self.pointer] != 0 {
                        self.instruction_pointer = loop_start;
                        self.loop_stack.push(loop_start);
                    }
                } else {
                    self.error = Some(BrainfuckError::UnmatchedCloseBracket);
                    self.finished = true;
                    return false;
                }
            }
            _ => {
            }
        }

        self.instruction_pointer += 1;
        true
    }

    #[wasm_bindgen]
    pub fn run(&mut self, max_steps: Option<usize>) -> JsValue {
        let limit = max_steps.unwrap_or(MAX_EXECUTION_STEPS).min(MAX_EXECUTION_STEPS);
        let mut steps = 0;

        while !self.finished && self.error.is_none() && steps < limit {
            if !self.step() {
                break;
            }
            steps += 1;
        }

        self.get_result()
    }

    #[wasm_bindgen]
    pub fn get_result(&self) -> JsValue {
        let start_idx = self.pointer.saturating_sub(50).max(0);
        let end_idx = (self.pointer + 50).min(self.memory.len());
        let memory_slice = self.memory[start_idx..end_idx].to_vec();
        
        let result = ExecutionResult {
            output: self.output.clone(),
            memory: memory_slice,
            pointer: self.pointer.saturating_sub(MEMORY_OFFSET),
            instruction_pointer: self.instruction_pointer,
            steps_executed: self.steps_executed,
            error: self.error.clone(),
            finished: self.finished,
            waiting_for_input: self.is_waiting_for_input(),
        };

        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen]
    pub fn get_output(&self) -> String {
        self.output.clone()
    }

    #[wasm_bindgen]
    pub fn get_memory_slice(&self, start: usize, length: usize) -> Vec<u8> {
        let end = (start + length).min(self.memory.len());
        if start >= self.memory.len() {
            return Vec::new();
        }
        self.memory[start..end].to_vec()
    }

    #[wasm_bindgen]
    pub fn get_pointer(&self) -> usize {
        self.pointer.saturating_sub(MEMORY_OFFSET)
    }

    #[wasm_bindgen]
    pub fn get_instruction_pointer(&self) -> usize {
        self.instruction_pointer
    }

    #[wasm_bindgen]
    pub fn is_finished(&self) -> bool {
        self.finished || self.error.is_some()
    }

    #[wasm_bindgen]
    pub fn get_steps_executed(&self) -> usize {
        self.steps_executed
    }

    #[wasm_bindgen]
    pub fn validate_program(program: &str) -> JsValue {
        let mut bracket_stack = Vec::new();
        let mut errors = Vec::new();

        for (i, ch) in program.chars().enumerate() {
            match ch {
                '[' => bracket_stack.push(i),
                ']' => {
                    if bracket_stack.pop().is_none() {
                        errors.push(format!("Unmatched ']' at position {}", i));
                    }
                }
                _ => {}
            }
        }

        while let Some(pos) = bracket_stack.pop() {
            errors.push(format!("Unmatched '[' at position {}", pos));
        }

        serde_wasm_bindgen::to_value(&errors).unwrap_or(JsValue::NULL)
    }
}

#[wasm_bindgen]
pub fn get_example_programs() -> JsValue {
    let examples = vec![
        ("Hello World", "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++."),
        ("Add two numbers", ",>,<[>+<-]>."),
        ("Multiply two numbers", ",>,<[>[>+>+<<-]>>[<<+>>-]<<<-]>>>."),
        ("Print numbers 1-10", "++++++++++[>++++++++++<-]>+++++.<++++[>++++<-]>+.[-]<++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+."),
        ("Cat program (echo input)", ",[.,]"),
        ("ROT13", "-,+[-[>>++++[>++++++++<-]<+<-[>+>+>-[>>>]<[[>+<-]>>+>]<<<<<-]]>>>[-]+>--[-[<->+++[-]]]<[++++++++++++<[>-[>+>>]>[+[<+>-]>+>>]<<<<<-]>>[<+>-]>[-[-<<[-]>>]<<[<<->>-]>>]<<[<<+>>-]]<[-]<.[-]<-,+]"),
    ];

    serde_wasm_bindgen::to_value(&examples).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen(start)]
pub fn main() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}