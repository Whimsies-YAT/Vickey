import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkWasmPack() {
    try {
        execSync('wasm-pack --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function installWasmPack() {
    console.log('Installing wasm-pack...');
    try {
        execSync('curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh', {
            stdio: 'inherit'
        });
        console.log('wasm-pack installed successfully!');
        return true;
    } catch (error) {
        console.error('Failed to install wasm-pack:', error.message);
        return false;
    }
}

async function buildWasm() {
    console.log('Building WebAssembly packages...');
    
    // Check if wasm-pack is installed
    if (!(await checkWasmPack())) {
        console.log('wasm-pack not found, attempting to install...');
        if (!(await installWasmPack())) {
            console.error('Failed to install wasm-pack. Please install it manually:');
            console.error('curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh');
            process.exit(1);
        }
    }
    
    const rustWorkspaceDir = path.join(__dirname, '../../rust-workspace');
    
    try {
        // Get all directories in rust-workspace
        const entries = await fs.readdir(rustWorkspaceDir, { withFileTypes: true });
        const wasmPackages = entries
            .filter(entry => entry.isDirectory() && entry.name !== 'target')
            .map(entry => entry.name);
        
        if (wasmPackages.length === 0) {
            console.log('No WebAssembly packages found in rust-workspace');
            return;
        }
        
        // Build each package
        for (const packageName of wasmPackages) {
            const packageDir = path.join(rustWorkspaceDir, packageName);
            
            // Check if Cargo.toml exists
            try {
                await fs.access(path.join(packageDir, 'Cargo.toml'));
            } catch {
                console.log(`Skipping ${packageName}: no Cargo.toml found`);
                continue;
            }
            
            console.log(`Building ${packageName}...`);
            
            // Convert package name to valid JS module name
            const outputName = packageName.replace(/-/g, '_');
            
            try {
                execSync(`wasm-pack build --target web --out-dir pkg --out-name ${outputName}`, {
                    cwd: packageDir,
                    stdio: 'inherit'
                });
                
                // Create symlink in node_modules if it doesn't exist
                const nodeModulesPath = path.join(__dirname, `node_modules/${packageName}`);
                const pkgPath = path.join(packageDir, 'pkg');
                
                try {
                    await fs.access(nodeModulesPath);
                    await fs.rm(nodeModulesPath, { recursive: true });
                } catch {
                    // Directory doesn't exist, which is fine
                }
                
                await fs.mkdir(path.dirname(nodeModulesPath), { recursive: true });
                await fs.symlink(pkgPath, nodeModulesPath);
                
                console.log(`Successfully built ${packageName}`);
            } catch (error) {
                console.error(`Error building ${packageName}:`, error.message);
                // Continue with other packages instead of exiting
            }
        }
        
        console.log('WebAssembly build completed!');
    } catch (error) {
        console.error('Error building WebAssembly packages:', error);
        process.exit(1);
    }
}

buildWasm().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
});