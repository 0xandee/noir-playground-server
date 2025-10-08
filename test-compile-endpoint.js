const http = require('http');

const postData = JSON.stringify({
  sourceCode: `pub fn main(x: Field, y: pub Field) -> pub Field {
    x + y
}`
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

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}\n`);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('RESPONSE:');
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));

      if (parsed.success) {
        console.log('\n✓ Compilation successful!');
        console.log(`Compilation time: ${parsed.compilationTime}ms`);
        if (parsed.artifact) {
          console.log('Artifact generated successfully');
        }
      } else {
        console.log('\n✗ Compilation failed:');
        console.log(parsed.error);
      }
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();
