#!/usr/bin/env python3
"""
KXKM Image Generation — SDXL Lightning via diffusers
Replaces ComfyUI for /imagine command.
Usage: python3 scripts/generate_image.py --prompt "cyberpunk cat" --output /tmp/img.png
Output: JSON on last line {"status":"completed","seed":123,"path":"/tmp/img.png"}
"""
import argparse, json, os, sys, time, random

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", default="/tmp/kxkm-imagine.png")
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    args = parser.parse_args()
    
    seed = args.seed if args.seed >= 0 else random.randint(0, 2**32)
    t0 = time.time()
    
    try:
        import torch
        from diffusers import StableDiffusionXLPipeline, EulerDiscreteScheduler
        
        model_id = "stabilityai/sdxl-turbo"
        pipe = StableDiffusionXLPipeline.from_pretrained(
            model_id, torch_dtype=torch.float16, variant="fp16"
        ).to("cuda")
        pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config)
        
        generator = torch.Generator("cuda").manual_seed(seed)
        image = pipe(
            prompt=args.prompt,
            num_inference_steps=args.steps,
            guidance_scale=0.0,
            width=args.width,
            height=args.height,
            generator=generator,
        ).images[0]
        
        image.save(args.output)
        duration = round(time.time() - t0, 1)
        print(json.dumps({"status": "completed", "seed": seed, "path": args.output, "duration": duration}))
        
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)[:200]}))
        sys.exit(1)

if __name__ == "__main__":
    main()
