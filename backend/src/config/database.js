import mongoose from 'mongoose';

export async function connectDatabase(uri) {
  await mongoose.connect(uri);
  return mongoose.connection;
}
