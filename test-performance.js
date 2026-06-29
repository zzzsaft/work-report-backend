import crypto from 'crypto';
import http from 'http';

const API_KEY = process.env.IMPORT_API_KEY;
const API_SECRET = process.env.IMPORT_API_SECRET;

function generateSignature(body) {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const raw = `${timestamp}.${nonce}.${body}`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex');
  return { timestamp, nonce, signature };
}

function generateTestData(count) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      orderNo: `WO-TEST-${String(i + 1).padStart(6, '0')}`,
      productCode: `PC-${String(i + 1).padStart(4, '0')}`,
      productName: `产品${i + 1}`,
      partNo: '1',
      partCode: `PART-${String(i + 1).padStart(4, '0')}`,
      partName: `零件${i + 1}`,
      operationNo: '10',
      operationCode: `OP-${String(i + 1).padStart(3, '0')}`,
      operationName: '加工',
      estimatedHours: 2.5,
      plannedQuantity: 1,
      dueDate: null
    });
  }
  return data;
}

async function testImport(count) {
  const data = generateTestData(count);
  const body = JSON.stringify(data);
  const { timestamp, nonce, signature } = generateSignature(body);

  console.log(`  Signature: ${signature.substring(0, 20)}...`);
  console.log(`  Body length: ${body.length}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 2020,
      path: '/api/operations/import',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Import-Key': API_KEY,
        'X-Import-Timestamp': String(timestamp),
        'X-Import-Nonce': nonce,
        'X-Import-Signature': signature,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        console.log(`  Status Code: ${res.statusCode}`);
        console.log(`  Response: ${responseBody.substring(0, 200)}${responseBody.length > 200 ? '...' : ''}`);
        try {
          resolve({ statusCode: res.statusCode, ...JSON.parse(responseBody) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: responseBody });
        }
      });
    });

    req.on('error', (e) => {
      console.log(`  Error: ${e.message}`);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!API_KEY || !API_SECRET) {
    throw new Error('IMPORT_API_KEY and IMPORT_API_SECRET are required');
  }

  console.log('=== Performance Test ===');
  console.log(`Date: ${new Date().toISOString()}`);
  
  const counts = [40000];
  
  for (const count of counts) {
    console.log(`\n--- Testing ${count} records ---`);
    const startTime = Date.now();
    
    try {
      const result = await testImport(count);
      const duration = Date.now() - startTime;
      
      console.log(`Status: ${result.statusCode || 'Success'}`);
      console.log(`Accepted: ${result.accepted || 0}`);
      console.log(`Rejected: ${result.rejected || 0}`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Speed: ${(count / duration * 1000).toFixed(1)} ops/sec`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }
  
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
