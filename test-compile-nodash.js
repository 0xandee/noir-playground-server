const http = require('http');

const postData = JSON.stringify({
  sourceCode: `pub fn main(x: Field, y: pub Field) -> pub Field {
    nodash::poseidon2([x, y])
}`,
  cargoToml: `[package]
name = "playground"
type = "bin"

[dependencies]
nodash = { git = "https://github.com/olehmisar/nodash", tag = "v0.42.0" }`
});

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/compile',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Testing compilation with nodash (external dependency)...\n');

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.success) {
        console.log('\n✓ Compilation successful with external dependencies!');
        console.log(`Compilation time: ${parsed.compilationTime}ms`);
        console.log(`Noir version: ${parsed.artifact.noir_version}`);
        console.log(`\nFunction: ${parsed.artifact.names.join(', ')}`);
        console.log(`ABI parameters: ${parsed.artifact.abi.parameters.length}`);

        if (parsed.warnings && parsed.warnings.length > 0) {
          console.log(`\nWarnings: ${parsed.warnings.length}`);
          parsed.warnings.forEach(w => console.log(`  - ${w}`));
        } else {
          console.log('\nNo warnings');
        }
      } else {
        console.log('\n✗ Compilation failed:');
        console.log(parsed.error);
      }
    } catch (e) {
      console.log('Failed to parse response:');
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();
