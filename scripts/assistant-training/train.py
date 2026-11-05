"""Train a Canvas Pro adapter from the JSONL exported by run.cjs."""
import argparse

from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("examples", help="Prompt/completion JSONL")
    parser.add_argument("output", help="Destination for the LoRA adapter")
    parser.add_argument("--model", default="google/functiongemma-270m-it")
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model)
    dataset = load_dataset("json", data_files=args.examples, split="train")
    config = SFTConfig(
        output_dir=args.output,
        max_length=2048,
        completion_only_loss=True,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=1e-4,
        num_train_epochs=3,
        seed=42,
        report_to="none",
        bf16=False,
        fp16=False,
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=LoraConfig(
            r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"], task_type="CAUSAL_LM"
        ),
    )
    trainer.train()
    trainer.save_model(args.output)


if __name__ == "__main__":
    main()
