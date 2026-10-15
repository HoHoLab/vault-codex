import readline from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({id: message.id, result: {userAgent: 'test'}});
  if (message.method === 'echo') send({id: message.id, result: message.params});
  if (message.method === 'fragment') {
    const result = Buffer.from(JSON.stringify({id: message.id, result: '连接成功 🧪'}) + '\n');
    process.stdout.write(result.subarray(0, result.length - 5));
    setTimeout(() => process.stdout.write(result.subarray(result.length - 5)), 10);
  }
  if (message.method === 'approval') {
    send({id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {command: 'echo test'}});
    send({id: message.id, result: true});
  }
  if (message.id === 'approval-1' && message.result) send({method: 'approval/resolved', params: message.result});
  if (message.method === 'crash') process.exit(3);
  if (message.method === 'invalid') process.stdout.write('not JSON\n');
});
