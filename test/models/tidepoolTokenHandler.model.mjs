import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const Schema = mongoose.Schema;

const TidepoolTokenHandlerSchema = new Schema({
  userId: {
    type: String,
    required: true,
    default: function getUUID() {
      return uuidv4();
    },
  },
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  token_expiry_date: { type: Date, required: true },
  create_date: { type: Date, expires: '35m', default: Date.now },
  email: { type: String, required: true },
  user_id: { type: String, required: true },
});

// Export the model
export default mongoose.model(
  'TidepoolTokenHandler',
  TidepoolTokenHandlerSchema
);
