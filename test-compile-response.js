const http = require('http');

const sourceCode = 'pub fn main(x: Field, y: pub Field) -> pub Field { x + y }';

const data = JSON.stringify({ sourceCode });

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/compile',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';

  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    const response = JSON.parse(body);
    console.log('Response structure:');
    console.log('- success:', response.success);
    console.log('- artifact keys:', response.artifact ? Object.keys(response.artifact) : 'no artifact');
    console.log('- program keys:', response.program ? Object.keys(response.program) : 'no program');

    if (response.artifact) {
      console.log('\nArtifact structure:');
      console.log(JSON.stringify(response.artifact, null, 2));
    }

    if (response.program) {
      console.log('\nProgram structure:');
      console.log('- Program has abi?', !!response.program.abi);
      if (response.program.abi) {
        console.log('- ABI keys:', Object.keys(response.program.abi));
        console.log('- Parameters:', response.program.abi.parameters);
      }
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
