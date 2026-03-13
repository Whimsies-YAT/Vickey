#!/bin/bash
set -e

echo "Building yume-pdq library..."

if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo not found. Please install Rust first."
    exit 1
fi

cd external/yume-pdq

echo "Compiling yume-pdq with optimizations..."

FEATURES="ffi"
if [[ "$(uname -m)" == *"x86"* ]] || [[ "$(uname -m)" == *"amd64"* ]]; then
    FEATURES="ffi prefer-x86-intrinsics"
fi

RUSTFLAGS="-Ctarget-cpu=native" cargo build --release --features "$FEATURES"
mkdir -p ../../packages/backend/lib
# Copy the built shared library
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    cp target/release/libyume_pdq.so ../../packages/backend/lib/
    echo "Copied libyume_pdq.so to backend/lib/"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    cp target/release/libyume_pdq.dylib ../../packages/backend/lib/
    echo "Copied libyume_pdq.dylib to backend/lib/"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    cp target/release/yume_pdq.dll ../../packages/backend/lib/
    echo "Copied yume_pdq.dll to backend/lib/"
fi

echo "yume-pdq build complete!"