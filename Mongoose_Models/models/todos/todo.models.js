import mongoose from "mongoose"

const todoSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
    },
    complete: {
      type: Boolean,
      default: false,
    },
    // one-to-one reference: store only the _id of the owning user
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // must match the string given to mongoose.model()
    },
    // one-to-many reference: an ARRAY of ObjectIds
    subTodos: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubTodo",
      },
    ],
  },
  { timestamps: true }
)

export const Todo = mongoose.model("Todo", todoSchema)
