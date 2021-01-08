import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const DatasetTempStorageSchema = new Schema({
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  token_expiry_date: { type: Date, required: true },
  dataset_id: { type: String, required: true },
  create_date: { type: Date },
  deviceInformation: { type: Buffer },
});

DatasetTempStorageSchema.pre('save', function (next) {
  if (!this.create_date) {
    this.create_date = new Date();
  }

  next();
});

// Export the model
export default mongoose.model('DatasetTempStorage', DatasetTempStorageSchema);
