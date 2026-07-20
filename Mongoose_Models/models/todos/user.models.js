import mongoose from "mongoose"

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"], // custom error message
    },
  },
  { timestamps: true } // adds createdAt + updatedAt automatically
)

// "User" -> mongo stores the collection as "users" (lowercase + plural)
export const User = mongoose.model("User", userSchema)
