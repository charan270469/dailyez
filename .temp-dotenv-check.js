import dotenv from 'dotenv';
const r = dotenv.config();
console.log('parsed error=' + (r.error ? r.error.message : 'none'));
console.log('GOOGLE_CLIENT_ID=' + process.env.GOOGLE_CLIENT_ID);
console.log('GOOGLE_CLIENT_SECRET=' + process.env.GOOGLE_CLIENT_SECRET);
console.log('GOOGLE_REDIRECT_URI=' + process.env.GOOGLE_REDIRECT_URI);
console.log('MONGODB_URI=' + (process.env.MONGODB_URI ? 'present' : 'missing'));