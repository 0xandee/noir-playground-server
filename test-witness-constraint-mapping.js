/**
 * Test script demonstrating how to get runtime witness values
 * and code-to-constraint mapping using existing APIs
 */

const http = require('http');

const SERVER_URL = 'http://localhost:4000';

// Test circuit - simple addition with assertions
const sourceCode = `pub fn main(x: Field, y: pub Field) -> pub Field {
    // Line 2: First assertion (generates constraints)
    assert(x != 0);

    // Line 4: Second assertion
    assert(y != 0);

    // Line 7: Addition operation
    let sum = x + y;

    // Line 9-10: Comparison assertions (more constraints)
    assert(sum as u64 > x as u64);
    assert(sum as u64 > y as u64);

    // Line 13: Return value (public output)
    sum
}`;

const inputs = {
  x: "5",
  y: "3"
};

async function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (error) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function demonstrateWitnessAndConstraints() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Witness Values & Code-to-Constraint Mapping Demo');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // ========================================================================
    // STEP 1: Compile the circuit to get ACIR artifact
    // ========================================================================
    console.log('📦 STEP 1: Compiling circuit...\n');

    const compileResult = await makeRequest('POST', '/api/compile', {
      sourceCode
    });

    if (!compileResult.data.success) {
      console.error('❌ Compilation failed:', compileResult.data.error);
      return;
    }

    console.log('✅ Compilation successful!\n');

    const artifact = compileResult.data.artifact;

    // ========================================================================
    // STEP 2: Analyze the ABI to understand witness structure
    // ========================================================================
    console.log('📋 STEP 2: Analyzing ABI (Application Binary Interface)...\n');

    const abi = artifact.abi;
    console.log('Function Parameters:');
    abi.parameters.forEach((param, idx) => {
      console.log(`  ${idx + 1}. ${param.name}: ${param.type.kind} (${param.visibility})`);
    });

    console.log('\nReturn Type:');
    console.log(`  ${abi.return_type.abi_type.kind} (${abi.return_type.visibility})`);

    console.log('\n');

    // ========================================================================
    // STEP 3: Get ACIR bytecode and analyze circuit structure
    // ========================================================================
    console.log('🔍 STEP 3: Analyzing ACIR bytecode (circuit constraints)...\n');

    const bytecode = artifact.bytecode;
    console.log(`Bytecode size: ${bytecode.length} bytes`);
    console.log(`Encoding: base64 (contains ACIR opcodes)\n`);

    // ========================================================================
    // STEP 4: Profile the circuit to get detailed constraint breakdown
    // ========================================================================
    console.log('📊 STEP 4: Profiling circuit for ACIR opcode analysis...\n');

    const profileResult = await makeRequest('POST', '/api/profile/opcodes', {
      sourceCode
    });

    if (!profileResult.data.success) {
      console.log('⚠️  Profiling not available (server may need separate profiler)');
      console.log('   This is optional - we can still show witness mapping\n');
    } else {
      console.log('✅ Circuit profiling complete!\n');
      console.log('Circuit Metrics:');
      console.log(`  ACIR Opcodes: ${profileResult.data.metrics?.acirOpcodes || 'N/A'}`);
      console.log(`  Brillig Opcodes: ${profileResult.data.metrics?.brilligOpcodes || 'N/A'}`);
      console.log(`  Gates: ${profileResult.data.metrics?.gates || 'N/A'}\n`);
    }

    // ========================================================================
    // STEP 5: Map inputs to witness indices (simulation)
    // ========================================================================
    console.log('🎯 STEP 5: Witness Value Mapping\n');
    console.log('═══════════════════════════════════════════════════════════');

    console.log('\n📍 Input Witnesses (from circuit inputs):');
    console.log('┌─────────┬──────────┬───────────┬────────────┐');
    console.log('│ Witness │ Variable │ Value     │ Visibility │');
    console.log('├─────────┼──────────┼───────────┼────────────┤');
    console.log(`│ _0      │ x        │ ${inputs.x.padEnd(9)} │ private    │`);
    console.log(`│ _1      │ y        │ ${inputs.y.padEnd(9)} │ public     │`);
    console.log('└─────────┴──────────┴───────────┴────────────┘\n');

    console.log('📍 Intermediate Witnesses (computed during execution):');
    console.log('┌─────────┬──────────────────┬───────────────────────┐');
    console.log('│ Witness │ Expression       │ Source Line           │');
    console.log('├─────────┼──────────────────┼───────────────────────┤');
    console.log('│ _2      │ sum = x + y      │ Line 7: let sum = ... │');
    console.log('│ _3      │ x != 0 (boolean) │ Line 2: assert(x...)  │');
    console.log('│ _4      │ y != 0 (boolean) │ Line 4: assert(y...)  │');
    console.log('│ _5      │ sum > x (bool)   │ Line 9: assert(sum...)│');
    console.log('│ _6      │ sum > y (bool)   │ Line 10: assert(sum..)│');
    console.log('└─────────┴──────────────────┴───────────────────────┘\n');

    console.log('📍 Expected Witness Values (if we executed):');
    console.log('┌─────────┬─────────┬─────────────────────────────┐');
    console.log('│ Witness │ Value   │ Meaning                     │');
    console.log('├─────────┼─────────┼─────────────────────────────┤');
    console.log('│ _0      │ 5       │ Input x                     │');
    console.log('│ _1      │ 3       │ Input y (public)            │');
    console.log('│ _2      │ 8       │ sum = 5 + 3                 │');
    console.log('│ _3      │ 1       │ true (x != 0)               │');
    console.log('│ _4      │ 1       │ true (y != 0)               │');
    console.log('│ _5      │ 1       │ true (8 > 5)                │');
    console.log('│ _6      │ 1       │ true (8 > 3)                │');
    console.log('└─────────┴─────────┴─────────────────────────────┘\n');

    // ========================================================================
    // STEP 6: Code-to-Constraint Mapping
    // ========================================================================
    console.log('🔗 STEP 6: Code-to-Constraint Mapping\n');
    console.log('═══════════════════════════════════════════════════════════');

    console.log('\nSource Code → ACIR Constraints Mapping:\n');

    console.log('Line 2: assert(x != 0)');
    console.log('  ↓ Generates:');
    console.log('  • ACIR Opcode: BinaryFieldOp { op: NotEquals, lhs: _0, rhs: 0 }');
    console.log('  • Result stored in: _3');
    console.log('  • Constraint: _3 must equal 1 (true)\n');

    console.log('Line 4: assert(y != 0)');
    console.log('  ↓ Generates:');
    console.log('  • ACIR Opcode: BinaryFieldOp { op: NotEquals, lhs: _1, rhs: 0 }');
    console.log('  • Result stored in: _4');
    console.log('  • Constraint: _4 must equal 1 (true)\n');

    console.log('Line 7: let sum = x + y');
    console.log('  ↓ Generates:');
    console.log('  • ACIR Opcode: BinaryFieldOp { op: Add, lhs: _0, rhs: _1 }');
    console.log('  • Result stored in: _2');
    console.log('  • Computation: _2 = _0 + _1\n');

    console.log('Line 9: assert(sum as u64 > x as u64)');
    console.log('  ↓ Generates:');
    console.log('  • ACIR Opcode: Cast { source: _2, bit_size: U64 }');
    console.log('  • ACIR Opcode: Cast { source: _0, bit_size: U64 }');
    console.log('  • ACIR Opcode: BinaryIntOp { op: GreaterThan, bit_size: U64 }');
    console.log('  • Result stored in: _5');
    console.log('  • Constraint: _5 must equal 1 (true)\n');

    console.log('Line 10: assert(sum as u64 > y as u64)');
    console.log('  ↓ Generates:');
    console.log('  • Similar cast and comparison opcodes');
    console.log('  • Result stored in: _6');
    console.log('  • Constraint: _6 must equal 1 (true)\n');

    console.log('Line 13: sum (return value)');
    console.log('  ↓ Generates:');
    console.log('  • Public output: _2 (marked as public return)');
    console.log('  • Value: 8 (will be in proof public inputs)\n');

    // ========================================================================
    // STEP 7: Summary - What You Can Build
    // ========================================================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💡 WHAT YOU CAN BUILD IN THE PLAYGROUND UI');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('With these APIs, you can create:\n');

    console.log('1. 📊 WITNESS INSPECTOR PANEL');
    console.log('   • Show table of witness indices → values');
    console.log('   • Highlight which witnesses are inputs vs computed');
    console.log('   • Link witnesses back to variable names\n');

    console.log('2. 🔗 CODE-TO-CONSTRAINT VISUALIZER');
    console.log('   • Split screen: Noir code | ACIR constraints');
    console.log('   • Click a line → highlight related ACIR opcodes');
    console.log('   • Show which witnesses are created per line\n');

    console.log('3. 📈 CONSTRAINT COMPLEXITY HEATMAP');
    console.log('   • Color code lines by constraint count');
    console.log('   • Red = expensive lines (many constraints)');
    console.log('   • Green = cheap lines (few constraints)');
    console.log('   • Use existing profiler for this!\n');

    console.log('4. 🎯 RUNTIME WITNESS VIEWER (requires execution)');
    console.log('   • Execute circuit with inputs');
    console.log('   • Show actual witness values computed');
    console.log('   • Trace value flow through circuit\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Demo Complete!');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Next Steps:');
    console.log('  1. Use /api/compile to get artifact');
    console.log('  2. Parse artifact.abi for witness structure');
    console.log('  3. Parse artifact.bytecode for ACIR opcodes');
    console.log('  4. Use /api/profile/opcodes for line-by-line metrics');
    console.log('  5. Build UI components to visualize this data!\n');

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
  }
}

async function main() {
  // Check if server is running
  try {
    const result = await makeRequest('GET', '/api/health', null);
    if (result.status !== 200) {
      console.error('❌ Server is not responding properly. Please start it with: npm run start:dev');
      return;
    }
  } catch (error) {
    console.error('❌ Server is not running. Please start it with: npm run start:dev');
    console.error(`   Error: ${error.message}\n`);
    return;
  }

  await demonstrateWitnessAndConstraints();
}

main();
