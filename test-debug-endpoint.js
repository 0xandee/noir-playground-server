/**
 * Test script for debug API endpoints
 */

const http = require('http');

const SERVER_URL = 'http://localhost:4000';

// Test circuit code
const sourceCode = `pub fn main(x: Field, y: pub Field) -> pub Field {
    // Verify that x and y are both non-zero
    assert(x != 0);
    assert(y != 0);

    // Compute the sum and verify it's greater than both inputs
    let sum = x + y;
    assert(sum as u64 > x as u64);
    assert(sum as u64 > y as u64);

    // Return the sum as proof output
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

async function testDebugAPI() {
  console.log('🧪 Testing Debug API...\n');

  try {
    // Step 1: Start debug session
    console.log('1️⃣  Starting debug session...');
    const startResult = await makeRequest('POST', '/api/debug/start', {
      sourceCode,
      inputs
    });

    console.log(`   Status: ${startResult.status}`);
    console.log(`   Response:`, JSON.stringify(startResult.data, null, 2));

    if (!startResult.data.success) {
      console.error('❌ Failed to start debug session');
      return;
    }

    const sessionId = startResult.data.sessionId;
    console.log(`   ✅ Session ID: ${sessionId}\n`);

    // Step 2: Execute a step command
    console.log('2️⃣  Executing step command (next)...');
    const stepResult = await makeRequest('POST', '/api/debug/step', {
      sessionId,
      command: 'next'
    });

    console.log(`   Status: ${stepResult.status}`);
    console.log(`   Response:`, JSON.stringify(stepResult.data, null, 2));

    if (stepResult.data.success) {
      console.log(`   ✅ Step executed successfully\n`);
    } else {
      console.log(`   ❌ Step failed: ${stepResult.data.error}\n`);
    }

    // Step 3: Get variables
    console.log('3️⃣  Fetching variables...');
    const variablesResult = await makeRequest('GET', `/api/debug/variables/${sessionId}`, null);

    console.log(`   Status: ${variablesResult.status}`);
    console.log(`   Response:`, JSON.stringify(variablesResult.data, null, 2));

    if (variablesResult.data.success) {
      console.log(`   ✅ Variables fetched: ${variablesResult.data.variables?.length || 0}\n`);
    } else {
      console.log(`   ⚠️  Variables failed: ${variablesResult.data.error}\n`);
    }

    // Step 4: Get witness map
    console.log('4️⃣  Fetching witness map...');
    const witnessResult = await makeRequest('GET', `/api/debug/witness/${sessionId}`, null);

    console.log(`   Status: ${witnessResult.status}`);
    console.log(`   Response:`, JSON.stringify(witnessResult.data, null, 2));

    if (witnessResult.data.success) {
      console.log(`   ✅ Witness entries: ${witnessResult.data.witnesses?.length || 0}\n`);
    } else {
      console.log(`   ⚠️  Witness failed: ${witnessResult.data.error}\n`);
    }

    // Step 5: Get opcodes
    console.log('5️⃣  Fetching opcodes...');
    const opcodesResult = await makeRequest('GET', `/api/debug/opcodes/${sessionId}`, null);

    console.log(`   Status: ${opcodesResult.status}`);
    console.log(`   Response:`, JSON.stringify(opcodesResult.data, null, 2));

    if (opcodesResult.data.success) {
      console.log(`   ✅ Opcodes fetched: ${opcodesResult.data.opcodes?.length || 0}\n`);
    } else {
      console.log(`   ⚠️  Opcodes failed: ${opcodesResult.data.error}\n`);
    }

    // Step 6: Terminate session
    console.log('6️⃣  Terminating debug session...');
    const deleteResult = await makeRequest('DELETE', `/api/debug/${sessionId}`, null);

    console.log(`   Status: ${deleteResult.status}`);

    if (deleteResult.status === 204) {
      console.log(`   ✅ Session terminated successfully\n`);
    } else {
      console.log(`   ❌ Failed to terminate session\n`);
    }

    console.log('✅ All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Check if server is running
async function checkServer() {
  try {
    const result = await makeRequest('GET', '/api/debug/health', null);
    console.log('✅ Server is running!\n');
    return true;
  } catch (error) {
    console.error('❌ Server is not running. Please start it with: npm run start:dev');
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        Noir Playground - Debug API Test Suite');
  console.log('═══════════════════════════════════════════════════════════\n');

  const serverRunning = await checkServer();

  if (serverRunning) {
    await testDebugAPI();
  }
}

main();
